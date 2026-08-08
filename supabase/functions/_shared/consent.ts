// Follow-up email consent: the wording, and the pure logic that turns a visitor's
// checkbox into an evidence row. No database, no network, no Deno globals — this
// module is imported by the edge runtime AND read by the frontend mirror test, so
// it must stay dependency-free.
//
// A hand-kept copy lives at src/lib/consent.ts (frontend and edge functions can't
// share a module — same arrangement as qualification.ts). The two files must
// render byte-identical strings; a vitest asserts it.
//
// WHY THE WORDING IS CODE, NOT CONTENT:
// §7 Abs. 2 UWG puts the burden of proof for consent on the sender. Proving it
// means reproducing exactly what the visitor read at the moment they ticked the
// box. So the client sends back WHICH version it rendered and WITH WHAT business
// name, the server rebuilds that same text from this module, and stores the
// result. A text the server cannot rebuild is a text nobody can prove. That is
// why buildConsentNotice returns null for an unknown version instead of guessing.
//
// Consequence: changing a single character of NOTICE_* below is a NEW VERSION.
// Bump CONSENT_NOTICE_VERSION, keep the old entry in the table, and let old rows
// keep proving what they were collected under. There is no lawful way to
// retro-fit new wording onto consent already given.

export type ConsentLocale = 'de' | 'en'

// Only 'email' exists. Named anyway so a stored row states its channel rather
// than implying it: OLG Hamm 18 U 154/22 pulled messenger DMs into "elektronische
// Post", so a consent that does not name its channel proves nothing about scope.
export type ConsentChannel = 'email'

export type ConsentAction = 'granted' | 'confirmed' | 'withdrawn'

export type ConsentSource =
  | 'contact_form'            // ticked the box on the /c/:slug contact form
  | 'contact_form_unticked'   // resubmitted the form WITHOUT the tick -> withdrawal
  | 'visitor_confirmation'    // clicked the link in the double-opt-in mail
  | 'visitor_unsubscribe'     // clicked unsubscribe in a follow-up mail
  | 'provider_bounce'         // hard bounce / complaint reported by the ESP
  | 'operator'                // manual, by us, on request

// 'none' is "we have never asked or they never ticked". Distinct from 'withdrawn',
// which is a positive act we must be able to show we honoured.
export type ConsentState = 'none' | 'granted' | 'confirmed' | 'withdrawn'

export const CONSENT_NOTICE_VERSION = 'concierge-followup-email-v1'

// Storage caps. An IPv6 address is at most 45 characters; user agents are
// attacker-controlled and unbounded, so they get truncated rather than trusted.
export const CONSENT_IP_MAX = 45
export const CONSENT_UA_MAX = 512
export const CONSENT_BUSINESS_NAME_MAX = 200
export const CONSENT_EMAIL_MAX = 320

// The retention period stated in the notice. It must equal the number in
// DatenschutzPage.tsx and in the migration's schema comment. Three years is
// §195 BGB, the window in which a claim over an unlawful mail can still arrive.
export const CONSENT_RETENTION_YEARS = 3

// ---------------------------------------------------------------------------
// The wording. Character-for-character load-bearing. See the header.
// ---------------------------------------------------------------------------

// The checkbox label. Deliberately SHORT and deliberately SEPARATE from the
// notice: the <label> element wraps only this, so clicking the five-sentence
// notice cannot toggle the box. A consent given by mis-clicking explanatory text
// is not a consent.
const LABEL: Record<ConsentLocale, (businessName: string) => string> = {
  de: (b) =>
    `Ja, ${b} darf mir zu diesem Gespräch eine E-Mail schreiben, auch wenn ich heute keinen Termin buche.`,
  en: (b) =>
    `Yes, ${b} may email me about this conversation, even if I do not book an appointment today.`,
}

// The notice. Every sentence answers one Art. 13 DSGVO / §7 UWG question:
// who sends, what channel, what scope, how many, how to revoke, who processes,
// how long we keep the proof, and that ticking is optional.
const NOTICE: Record<ConsentLocale, (businessName: string) => string> = {
  de: (b) =>
    `Wir schicken dir gleich eine kurze Bestätigungsmail. Erst wenn du darin auf den Link klickst, gilt die Einwilligung. Sie gilt nur für ${b} und nur für E-Mail, es geht ausschließlich um dieses Gespräch, eine einzige E-Mail, kein Newsletter, keine Weitergabe an Dritte. Du kannst jederzeit widerrufen, mit einem Klick am Ende der E-Mail. Der Versand läuft technisch über 2Fronts (2fronts.de) im Auftrag von ${b}. Deine Einwilligung speichern wir mit Zeitpunkt drei Jahre lang, um sie belegen zu können, mehr dazu in der Datenschutzerklärung. Ohne Häkchen kannst du hier ganz normal weiterschreiben und einen Termin buchen.`,
  en: (b) =>
    `We will send you a short confirmation email in a moment. Your consent only counts once you click the link in it. It applies to ${b} only and to email only, it covers this conversation and nothing else, a single email, no newsletter, no sharing with third parties. You can withdraw at any time, with one click at the bottom of that email. The sending runs technically through 2Fronts (2fronts.de) on behalf of ${b}. We store your consent with a timestamp for three years so we can prove it, more on this in the privacy policy. Without the tick you can carry on chatting here and book an appointment as normal.`,
}

export interface ConsentNotice {
  version: string
  locale: ConsentLocale
  label: string
  notice: string
  rendered_business_name: string
}

// Rebuild the exact text a visitor saw. Returns null for a version this build
// does not know — the caller must then refuse to store anything, because it
// cannot prove what was on screen. Never fall back to the current version: that
// would file a row claiming the visitor read words they never saw.
export function buildConsentNotice(
  version: string,
  locale: ConsentLocale,
  businessName: string,
): ConsentNotice | null {
  if (version !== CONSENT_NOTICE_VERSION) return null
  if (locale !== 'de' && locale !== 'en') return null
  const name = businessName.trim()
  if (!name || name.length > CONSENT_BUSINESS_NAME_MAX) return null
  return {
    version,
    locale,
    label: LABEL[locale](name),
    notice: NOTICE[locale](name),
    rendered_business_name: name,
  }
}

// ---------------------------------------------------------------------------
// Submission parsing
// ---------------------------------------------------------------------------

// What the browser sends alongside name+email when the box is ticked. It is a
// CLAIM about what was rendered, never trusted as content: the server rebuilds
// the text itself and stores its own rendering.
export interface ConsentSubmission {
  notice_version: string
  locale: ConsentLocale
  rendered_business_name: string
}

// Returns null for anything that is not a well-formed claim. The caller must
// treat null as "no consent" and still accept the contact — a malformed consent
// object is our bug or someone poking the endpoint, and neither is a reason to
// lose the coach their lead.
export function parseConsentSubmission(raw: unknown): ConsentSubmission | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const c = raw as Record<string, unknown>
  const version = typeof c.notice_version === 'string' ? c.notice_version.trim() : ''
  const locale = c.locale
  const rendered =
    typeof c.rendered_business_name === 'string' ? c.rendered_business_name.trim() : ''
  if (!version || version.length > 100) return null
  if (locale !== 'de' && locale !== 'en') return null
  // No rendered name means we cannot check that the visitor saw the same sender
  // we are about to bind the consent to. That check is the whole anti-forgery
  // design, so a submission without it is worthless, not merely incomplete.
  if (!rendered || rendered.length > CONSENT_BUSINESS_NAME_MAX) return null
  return { notice_version: version, locale, rendered_business_name: rendered }
}

// ---------------------------------------------------------------------------
// Email normalisation
// ---------------------------------------------------------------------------

// The subject key of a consent is (concierge_id, visitor_email_norm). Lowercase
// + trim only: no dot-stripping, no plus-stripping. Those are Gmail conventions,
// not RFC ones, and treating a+b@x.de as a@x.de would silently bind one person's
// consent to a different mailbox.
export function normalizeConsentEmail(email: string): string {
  return email.trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ConsentLedgerEntry {
  action: ConsentAction
  created_at: string
}

// The ledger is append-only, so state is derived, never stored. Latest row wins.
//
// TIES RESOLVE TO 'withdrawn'. Two rows can share a timestamp (same statement,
// clock granularity, a replayed request). In that ambiguity the only safe answer
// is the one that sends no mail: a wrongly-withheld follow-up costs a lead, a
// wrongly-sent one costs an Abmahnung.
export function effectiveConsentState(entries: ConsentLedgerEntry[]): ConsentState {
  if (entries.length === 0) return 'none'
  let latest = ''
  for (const e of entries) {
    if (e.created_at > latest) latest = e.created_at
  }
  const atLatest = entries.filter((e) => e.created_at === latest).map((e) => e.action)
  if (atLatest.includes('withdrawn')) return 'withdrawn'
  if (atLatest.includes('confirmed')) return 'confirmed'
  if (atLatest.includes('granted')) return 'granted'
  return 'none'
}

// The single gate every send path must pass through.
//
// 'granted' is NOT enough and that is the point of double opt-in: a ticked box
// only proves that whoever was at the keyboard typed that address, not that they
// own it. Confirming the mail is what ties the address to a person.
export function maySendFollowup(state: ConsentState): boolean {
  return state === 'confirmed'
}

// ---------------------------------------------------------------------------
// Row construction
// ---------------------------------------------------------------------------

// The wording snapshot carried by an existing row, needed to word a withdrawal
// in the same terms the grant was given in.
export interface ConsentSnapshot {
  notice_version: string
  notice_label: string
  notice_text: string
  rendered_business_name: string
  locale: ConsentLocale
}

export interface ConsentRow {
  concierge_id: string
  conversation_id: string | null
  // Denormalised from concierges.owner_id. This, not concierge_id, is what
  // survives the coach deleting and re-creating their setter — observed
  // behaviour, see 20260729100000's header.
  sender_owner_id: string | null
  visitor_email: string
  visitor_email_norm: string
  action: ConsentAction
  source: ConsentSource
  channel: ConsentChannel
  notice_version: string
  notice_label: string
  notice_text: string
  rendered_business_name: string
  locale: ConsentLocale
  visitor_ip: string | null
  visitor_user_agent: string | null
  // NOTE: no created_at. The database owns the timestamp (default now()). An
  // isolate-supplied time is a clock we do not control appearing in evidence.
}

export type ConsentRejectReason =
  | 'ok'
  | 'no_consent_no_prior'      // unticked, nothing to withdraw. Normal. Silent.
  | 'already_granted'          // ticked again over a live grant. Normal. Silent.
  | 'malformed'                // consent object present but not parseable. Bug or probe.
  | 'version_mismatch'         // client rendered a version this build cannot rebuild.
  | 'locale_mismatch'          // client rendered a different language than the concierge speaks.
  | 'business_name_mismatch'   // client rendered a different sender than we would bind to.

export interface BuildConsentRowInput {
  // The parsed claim, or null when the box was not ticked.
  submission: ConsentSubmission | null
  concierge_id: string
  conversation_id: string | null
  sender_owner_id: string | null
  visitor_email: string
  // Authoritative, server-side. Never the client's rendered_business_name.
  business_name: string
  // Authoritative, server-side, from concierges.language (already clamped).
  locale: ConsentLocale
  prior_state: ConsentState
  prior_snapshot: ConsentSnapshot | null
  visitor_ip?: string | null
  visitor_user_agent?: string | null
}

export interface BuildConsentRowResult {
  row: ConsentRow | null
  reason: ConsentRejectReason
}

function clamp(v: string | null | undefined, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  return t.length > max ? t.slice(0, max) : t
}

// The three mismatch reasons are the ones the caller must ALERT on. They mean the
// screen and the server disagree about what was consented to, which is either a
// deploy skew or someone forging submissions. Both need a human.
export function isConsentMismatch(reason: ConsentRejectReason): boolean {
  return (
    reason === 'version_mismatch' ||
    reason === 'locale_mismatch' ||
    reason === 'business_name_mismatch'
  )
}

export function buildConsentRow(input: BuildConsentRowInput): BuildConsentRowResult {
  const {
    submission,
    prior_state,
    prior_snapshot,
    business_name,
    locale,
    visitor_email,
  } = input

  const base = {
    concierge_id: input.concierge_id,
    conversation_id: input.conversation_id,
    sender_owner_id: input.sender_owner_id,
    visitor_email: visitor_email.trim(),
    visitor_email_norm: normalizeConsentEmail(visitor_email),
    channel: 'email' as const,
    visitor_ip: clamp(input.visitor_ip, CONSENT_IP_MAX),
    visitor_user_agent: clamp(input.visitor_user_agent, CONSENT_UA_MAX),
  }

  // --- Not ticked -------------------------------------------------------
  //
  // Re-submitting the contact form without the tick, over a live grant, is a
  // WITHDRAWAL. The visitor used the only control the page gives them; reading
  // that as "no change" would leave them unable to take it back on the same
  // screen where they gave it.
  if (!submission) {
    if (prior_state !== 'granted' && prior_state !== 'confirmed') {
      return { row: null, reason: 'no_consent_no_prior' }
    }
    // Word the withdrawal in the terms of the grant it revokes. Falling back to
    // the CURRENT wording would file a withdrawal quoting text this visitor
    // never saw.
    const snap = prior_snapshot
    return {
      row: {
        ...base,
        action: 'withdrawn',
        source: 'contact_form_unticked',
        notice_version: snap?.notice_version ?? CONSENT_NOTICE_VERSION,
        notice_label: snap?.notice_label ?? '',
        notice_text: snap?.notice_text ?? '',
        rendered_business_name: snap?.rendered_business_name ?? business_name.trim(),
        locale: snap?.locale ?? locale,
      },
      reason: 'ok',
    }
  }

  // --- Ticked -----------------------------------------------------------
  if (prior_state === 'granted' || prior_state === 'confirmed') {
    // Already live. A second grant row would add no evidence and would reset
    // nothing; the ledger stays clean.
    return { row: null, reason: 'already_granted' }
  }

  if (submission.notice_version !== CONSENT_NOTICE_VERSION) {
    return { row: null, reason: 'version_mismatch' }
  }
  if (submission.locale !== locale) {
    return { row: null, reason: 'locale_mismatch' }
  }
  const rebuilt = buildConsentNotice(submission.notice_version, locale, business_name)
  if (!rebuilt) return { row: null, reason: 'version_mismatch' }
  if (submission.rendered_business_name !== rebuilt.rendered_business_name) {
    // The visitor read one sender's name and we were about to bind the consent
    // to another. Refuse, loudly.
    return { row: null, reason: 'business_name_mismatch' }
  }

  return {
    row: {
      ...base,
      action: 'granted',
      source: 'contact_form',
      notice_version: rebuilt.version,
      notice_label: rebuilt.label,
      notice_text: rebuilt.notice,
      rendered_business_name: rebuilt.rendered_business_name,
      locale: rebuilt.locale,
    },
    reason: 'ok',
  }
}
