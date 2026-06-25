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
): Promise<ConciergeChatReply> {
  const { data, error } = await supabase.functions.invoke('concierge-chat', {
    body: { slug, session_id: sessionId, message, answer },
  })
  if (error) throw new Error(await readChatErrorKey(error))
  return data as ConciergeChatReply
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
