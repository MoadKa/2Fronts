import { supabase } from '../lib/supabaseClient'
import type { QualAnswer, QualCriterion, QualPrompt } from '../lib/qualification'

// Client-side surface of the AI Booking Concierge:
//   sendConciergeMessage -> the public chat (calls the concierge-chat edge fn)
//   createConcierge      -> setup, after purchase (inserts the owner's row, RLS
//                           enforces owner_id = auth.uid())
// The coach's offer/qa are never read here: the public page only ever sees the
// AI's reply, and setup only writes. Error messages are i18n KEYS the pages
// resolve, so a visitor/coach never sees a raw code or stack.

export interface ConciergeChatReply {
  reply: string
  show_booking: boolean
  calendar_url?: string
  // Present when the concierge wants the visitor to answer the next qualification
  // criterion: the chat renders these options as quick-reply buttons. (S-C runtime.)
  quick_replies?: QualPrompt
  // True when the server is gating the booking behind contact: the page must show
  // the name + email form, then resubmit via the `contact` arg. (v1.4)
  request_contact?: boolean
}

// The visitor's contact details from the name/email form (gated before booking).
export interface ConciergeContact {
  name: string
  email: string
}

export type ConciergeLanguage = 'de' | 'en'

export interface CreateConciergeInput {
  slug: string
  business_name: string
  offer_description: string
  qa: string
  tone: string
  language: ConciergeLanguage
  calendar_url: string
  // Ideal-customer criteria the concierge qualifies visitors against in chat.
  // Optional/empty = no qualification (concierge behaves exactly as before). The
  // wizard (S-B) supplies it; older callers omit it. (S-B wizard.)
  qualification_criteria?: QualCriterion[]
}

export interface Concierge {
  id: string
  slug: string
}

// A draft profile the wizard's scrape accelerator returns. Every field is
// optional: the coach edits whatever came back and fills the rest.
export interface ConciergeDraft {
  offer_description?: string
  qa?: string
  tone?: 'friendly' | 'professional' | 'casual'
  calendar_url?: string
}

// A throwaway per-visitor id so the AI can follow the thread across messages. No
// PII, never persisted beyond the conversation row. crypto.randomUUID when
// available; a timestamp+random fallback keeps it working in older browsers/SSR.
export function newSessionId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// Read the edge function's error code (carried on a FunctionsHttpError's
// `.context`) and map it to a customer-friendly i18n key. Mirrors SlackService.
async function readChatErrorKey(error: unknown): Promise<string> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string }
      if (body?.error === 'not_found') return 'conciergeChat.unavailable'
    } catch {
      // fall through
    }
  }
  return 'conciergeChat.error'
}

/**
 * Send one visitor message to the concierge and get the AI's reply. The slug,
 * the per-visitor session id, and the message go to the public concierge-chat
 * edge function, which loads the coach's content server-side (RLS hides it from
 * the browser) and returns only the reply + a booking signal. Throws an Error
 * whose message is an i18n key (conciergeChat.*) on failure.
 */
export async function sendConciergeMessage(
  slug: string,
  sessionId: string,
  message: string,
  // Set when the visitor clicked a quick-reply button: the chosen qualification
  // answer. The edge function records it and returns the next prompt. (S-C runtime.)
  answer?: QualAnswer,
  // Set when the visitor TYPED free text while a qualification question was
  // pending: the id of that open criterion. The server interprets the text
  // against it (answer? other? unrelated question?) instead of ignoring it. (v1.3)
  pendingCriterionId?: string,
  // Set when the visitor submitted the name/email form: the server stores it and
  // returns the booking. message may be empty on this turn. (v1.4)
  contact?: ConciergeContact,
): Promise<ConciergeChatReply> {
  const { data, error } = await supabase.functions.invoke('concierge-chat', {
    body: { slug, session_id: sessionId, message, answer, pending_criterion_id: pendingCriterionId, contact },
  })
  if (error) throw new Error(await readChatErrorKey(error))
  return data as ConciergeChatReply
}

// ---- Coach chat dashboard (#concierge-dashboard) ---------------------------
// One conversation row as the owner sees it in the dashboard list.
export interface ConciergeChatSummary {
  id: string
  visitor_session_id: string
  visitor_name: string | null
  visitor_email: string | null
  outcome: 'open' | 'booking_shown' | 'booking_clicked'
  qualified: boolean | null
  qualification_answers: QualAnswer[]
  created_at: string
  concierge: { slug: string; business_name: string } | null
}

export interface ConciergeChatMessage {
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

/**
 * List every conversation across the signed-in coach's concierge(s), newest
 * first. RLS scopes the rows to concierges the caller owns (owners-read policy),
 * so no filter is needed here. Throws an i18n-key Error on failure.
 */
export async function listConciergeChats(): Promise<ConciergeChatSummary[]> {
  const { data, error } = await supabase
    .from('concierge_conversations')
    .select(
      'id, visitor_session_id, visitor_name, visitor_email, outcome, qualified, qualification_answers, created_at, concierge:concierges(slug, business_name)',
    )
    .order('created_at', { ascending: false })
  if (error) throw new Error('conciergeChats.loadFailed')
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    const c = row.concierge
    const concierge = Array.isArray(c) ? (c[0] ?? null) : (c ?? null)
    return {
      id: row.id as string,
      visitor_session_id: row.visitor_session_id as string,
      visitor_name: (row.visitor_name as string | null) ?? null,
      visitor_email: (row.visitor_email as string | null) ?? null,
      outcome: row.outcome as ConciergeChatSummary['outcome'],
      qualified: (row.qualified as boolean | null) ?? null,
      qualification_answers: Array.isArray(row.qualification_answers)
        ? (row.qualification_answers as QualAnswer[])
        : [],
      created_at: row.created_at as string,
      concierge: concierge as ConciergeChatSummary['concierge'],
    }
  })
}

/**
 * Load the full transcript of one conversation (oldest first). RLS lets the
 * owner read only messages from their own concierge's conversations.
 */
export async function getConciergeChatMessages(conversationId: string): Promise<ConciergeChatMessage[]> {
  const { data, error } = await supabase
    .from('concierge_messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw new Error('conciergeChats.loadFailed')
  return (data ?? []) as ConciergeChatMessage[]
}

/**
 * Create the coach's concierge row at setup time (after purchase). owner_id is
 * the signed-in user; RLS only lets a user write their own. A duplicate slug
 * (unique constraint) maps to a clear "slug taken" key so the form can surface
 * it. Returns the new concierge ({ id, slug }) so the caller can link the
 * provision and show the live /c/<slug> link.
 */
export async function createConcierge(input: CreateConciergeInput): Promise<Concierge> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('conciergeSetup.mustSignIn')

  const { data, error } = await supabase
    .from('concierges')
    .insert({
      owner_id: userId,
      slug: input.slug,
      business_name: input.business_name,
      offer_description: input.offer_description,
      qa: input.qa,
      tone: input.tone,
      language: input.language,
      calendar_url: input.calendar_url,
      qualification_criteria: input.qualification_criteria ?? [],
    })
    .select()
    .single()

  if (error) {
    // 23505 = unique_violation -> the slug is already taken.
    if ((error as { code?: string }).code === '23505') throw new Error('conciergeSetup.slugTaken')
    throw new Error('conciergeSetup.saveFailed')
  }
  return data as Concierge
}

/**
 * Link a created concierge to its purchase provision (config.concierge_id) via
 * the concierge-setup edge function. Customers can't UPDATE their provision
 * (RLS), so this one write happens server-side, gated by JWT-owns-provision.
 * Best-effort from the page's view: the concierge already exists and works; this
 * just records the link for the platform. Throws conciergeSetup.saveFailed on
 * failure so the caller can decide whether to surface it.
 */
export async function linkProvisionToConcierge(provisionId: string, conciergeId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('concierge-setup', {
    body: { provisionId, conciergeId },
  })
  if (error) throw new Error('conciergeSetup.saveFailed')
}

/**
 * Optional onboarding accelerator (#26): scrape the coach's website and have the
 * server draft a first concierge profile they can edit. Calls the authed
 * concierge-draft-from-url edge function. This is best-effort — on ANY failure
 * the caller falls back to manual entry — so it throws a single generic Error
 * and never blocks the wizard.
 */
export async function draftConciergeFromUrl(
  url: string,
  language: ConciergeLanguage,
): Promise<ConciergeDraft> {
  const { data, error } = await supabase.functions.invoke('concierge-draft-from-url', {
    body: { url, language },
  })
  if (error) throw new Error('conciergeOnboarding.errors.scrapeFailed')
  const draft = (data as { draft?: ConciergeDraft } | null)?.draft
  return draft ?? {}
}
