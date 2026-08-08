import { supabase } from '../lib/supabaseClient'
import type { QualAnswer, QualCriterion, QualPrompt } from '../lib/qualification'
import type { ConsentAction, ConsentLocale, ConsentSubmission } from '../lib/consent'

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
  /**
   * The follow-up email consent, present ONLY when the visitor ticked the box on
   * a screen that actually named the sender. Optional so every existing caller
   * compiles unchanged — and, more importantly, so "no consent" is expressed by
   * the key being absent rather than by a falsy value the server has to
   * interpret. An unticked box and a box that was never rendered must look
   * identical on the wire; buildConsentSubmission collapses both to null and the
   * caller drops the key.
   *
   * This is a CLAIM about what was on screen, not a decision: the browser sends
   * the version + locale + rendered name, and the server re-renders the same
   * text from its own copy and refuses the row if the two disagree.
   */
  consent?: ConsentSubmission
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
  // The qualifying questions the concierge asks before offering a booking. The
  // server validates these against the runtime's contract before they get here,
  // so anything present is safe to drop straight into the wizard's editor.
  qualification_criteria?: QualCriterion[]
}

// A throwaway per-visitor id so the AI can follow the thread across messages. No
// PII, never persisted beyond the conversation row. crypto.randomUUID when
// available; a timestamp+random fallback keeps it working in older browsers/SSR.
export function newSessionId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// The two failure keys this module throws. They double as control-flow sentinels
// on the page (an unavailable slug gets its own screen), so they are constants
// rather than literals repeated across files — renaming the translation key
// would otherwise break that branch with no compiler error.
export const CONCIERGE_UNAVAILABLE = 'conciergeChat.unavailable'
export const CONCIERGE_ERROR = 'conciergeChat.error'

// Read the edge function's error code (carried on a FunctionsHttpError's
// `.context`) and map it to a customer-friendly i18n key. Mirrors SlackService.
async function readChatErrorKey(error: unknown): Promise<string> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string }
      if (body?.error === 'not_found') return CONCIERGE_UNAVAILABLE
    } catch {
      // fall through
    }
  }
  return CONCIERGE_ERROR
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

// What the public page needs BEFORE the first turn: which language this
// concierge speaks, so its opening screen matches the coach's setting instead of
// the visitor's browser. business_name comes along for the document title.
export interface ConciergeIntro {
  language: ConciergeLanguage
  business_name: string
  /**
   * True when this concierge is a sales demo built for a prospect rather than a
   * paying coach's own setter. The public page renders a visible disclosure line
   * for it: the page speaks as a named real business, so it has to say what it
   * is. Defaults to false, which is the safe reading of any older function
   * deploy that doesn't send the field yet.
   */
  is_demo: boolean
}

/**
 * Ask the concierge-chat edge function which language/name a slug is configured
 * with. A probe turn: no session, no message, no model call, and the coach's
 * offer/qa still never leave the server. Throws an i18n key like the send path,
 * so an unknown slug surfaces the same "unavailable" screen.
 */
export async function fetchConciergeIntro(slug: string): Promise<ConciergeIntro> {
  const { data, error } = await supabase.functions.invoke('concierge-chat', {
    body: { slug, probe: true },
  })
  if (error) throw new Error(await readChatErrorKey(error))
  // This endpoint serves two unrelated 200 shapes (chat reply vs intro), so the
  // reply is checked rather than cast: during a partial deploy the old function
  // can answer 200 in the other shape, and a blind cast would hand the page an
  // object of undefineds instead of a failure it knows how to degrade from.
  const intro = data as Partial<ConciergeIntro> | null
  if (!intro || (intro.language !== 'de' && intro.language !== 'en')) {
    throw new Error(CONCIERGE_ERROR)
  }
  return {
    language: intro.language,
    business_name: String(intro.business_name ?? ''),
    is_demo: intro.is_demo === true,
  }
}

// ---- Coach chat dashboard (#concierge-dashboard) ---------------------------
// One conversation row as the owner sees it in the dashboard list.
export interface ConciergeChatSummary {
  id: string
  // Which setter this conversation happened on. Carried because the consent
  // subject key is (concierge_id, visitor_email_norm) — the dashboard cannot
  // look a visitor's consent up by conversation, and must not look it up by
  // slug, which the owner can rename at will.
  //
  // NOTE: no consent_state on this interface, on purpose. One row here is one
  // CONVERSATION; a visitor with two sessions who ticked in one would get
  // 'granted' on one card and 'none' on the other, while the send path treats
  // both as the same subject. The state is derived per ADDRESS, on the page.
  concierge_id: string
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

// One of the coach's concierges, for the dashboard's "your links" section.
export interface MyConcierge {
  id: string
  slug: string
  business_name: string
}

/**
 * List the signed-in coach's own concierge(s) (RLS: owner_id = auth.uid()), so
 * the dashboard can show the customer link(s) even before any chat exists.
 */
export async function listMyConcierges(): Promise<MyConcierge[]> {
  const { data, error } = await supabase
    .from('concierges')
    .select('id, slug, business_name')
    .order('created_at', { ascending: true })
  if (error) throw new Error('conciergeChats.loadFailed')
  return (data ?? []) as MyConcierge[]
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
      'id, concierge_id, visitor_session_id, visitor_name, visitor_email, outcome, qualified, qualification_answers, created_at, concierge:concierges(slug, business_name)',
    )
    .order('created_at', { ascending: false })
  if (error) throw new Error('conciergeChats.loadFailed')
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    const c = row.concierge
    const concierge = Array.isArray(c) ? (c[0] ?? null) : (c ?? null)
    return {
      id: row.id as string,
      concierge_id: row.concierge_id as string,
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

// ---- Follow-up consent evidence (#concierge-consent) -----------------------

/**
 * One row of the append-only consent ledger, as the coach is allowed to read it.
 *
 * Every row carries its OWN wording snapshot (notice_version + notice_text +
 * rendered_business_name + locale), copied forward onto confirmations and
 * withdrawals rather than rebuilt. That is the point: a coach challenged over a
 * mail has to show what stood on the visitor's screen that day, which may be an
 * older version than the one this build renders.
 */
export interface ConciergeConsentRecord {
  concierge_id: string
  visitor_email_norm: string
  action: ConsentAction
  created_at: string
  notice_version: string
  notice_label: string
  notice_text: string
  rendered_business_name: string
  locale: ConsentLocale
}

/**
 * The columns, spelled out one by one. This is NOT style.
 *
 * Migration 20260808120000 revokes the table-level SELECT on
 * concierge_consents and hands `authenticated` a COLUMN-level grant instead:
 * visitor_ip and visitor_user_agent (personal data collected to prove the act to
 * a court, not to profile a lead) and confirm_token / confirm_token_expires_at
 * (a LIVE credential — whoever holds it can complete a double opt-in on the
 * visitor's behalf) are withheld from the coach on purpose.
 *
 * A `select('*')` does not quietly drop those four. It fails the whole request
 * with a permission error, and this list is what keeps that from happening. Add
 * a column here only after checking it appears in that migration's grant.
 */
const CONSENT_COLUMNS = [
  'concierge_id',
  'visitor_email_norm',
  'action',
  'created_at',
  'notice_version',
  'notice_label',
  'notice_text',
  'rendered_business_name',
  'locale',
].join(', ')

/**
 * Read the consent ledger for one of the coach's concierges, newest first. RLS
 * ("senders read own consent evidence") already limits this to evidence the
 * caller answers for; the eq() is scoping, not security.
 *
 * Returns ROWS, not a state. The subject of a consent is
 * (concierge_id, visitor_email_norm) and one address can appear across several
 * conversations, so the caller groups by that pair and derives the state with
 * effectiveConsentState. Throws the same i18n-key Error as the other dashboard
 * reads.
 */
export async function listConciergeConsents(conciergeId: string): Promise<ConciergeConsentRecord[]> {
  const { data, error } = await supabase
    .from('concierge_consents')
    .select(CONSENT_COLUMNS)
    .eq('concierge_id', conciergeId)
    .order('created_at', { ascending: false })
  if (error) throw new Error('conciergeChats.loadFailed')
  return (data ?? []) as unknown as ConciergeConsentRecord[]
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

// What the coach types into the optional follow-up sender panel. The
// acknowledgement is NOT in here: it is a boolean the page passes separately and
// this module turns into the `ack` flag, so nobody can mistake it for a stored
// field the browser owns.
export interface FollowupSenderInput {
  senderBlock: string
  privacyUrl: string
  replyTo: string
}

/**
 * Save the coach's follow-up sender identity (optional, from the "you're live"
 * screen). Goes through the concierge-setup edge function rather than a direct
 * table write, because followup_sender_ack_at / followup_sender_ack_version are
 * locked against client writes by migration 20260809100000 — the timestamp and
 * the wording version are OUR record that the coach was shown the
 * acknowledgement, so the browser must not be able to mint them. This call sends
 * only `ack: true`; the server decides what that means and when it happened.
 *
 * Throws an i18n-key Error the panel resolves. The concierge is already live, so
 * a failure here costs the follow-up feature, nothing else.
 */
export async function saveFollowupSender(
  provisionId: string,
  conciergeId: string,
  input: FollowupSenderInput,
): Promise<void> {
  const { error } = await supabase.functions.invoke('concierge-setup', {
    body: {
      provisionId,
      conciergeId,
      followupSender: {
        sender_block: input.senderBlock.trim(),
        privacy_url: input.privacyUrl.trim(),
        reply_to: input.replyTo.trim(),
        ack: true,
      },
    },
  })
  if (error) throw new Error('conciergeOnboarding.followup.errors.saveFailed')
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
