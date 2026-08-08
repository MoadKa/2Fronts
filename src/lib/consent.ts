// Follow-up email consent — frontend copy of the wording contract.
//
// A Deno copy lives at supabase/functions/_shared/consent.ts (frontend and edge
// functions can't share a module — same arrangement as qualification.ts). This
// file carries ONLY the parts the browser needs: the version, the types, and the
// two strings it renders. The evidence logic (row construction, state machine,
// mismatch classification) is server-side and deliberately not mirrored — the
// browser must never be able to decide what gets stored.
//
// THE TWO FILES MUST RENDER BYTE-IDENTICAL STRINGS. src/lib/consent.test.ts
// asserts it by reading the Deno file off disk. If that test fails, do not
// "fix" it by editing one side: work out which text real visitors actually saw,
// and bump CONSENT_NOTICE_VERSION on both sides.
//
// Why so strict: §7 Abs. 2 UWG puts the burden of proof for consent on the
// sender. The server rebuilds the text the browser rendered and stores its own
// rendering. If the two drift, the stored evidence describes a screen that never
// existed, and the consent is worth nothing at exactly the moment it matters.

export type ConsentLocale = 'de' | 'en'

export const CONSENT_NOTICE_VERSION = 'concierge-followup-email-v1'

// The three things that can happen to a consent, same union as the Deno copy and
// same three values the table's CHECK constraint allows.
export type ConsentAction = 'granted' | 'confirmed' | 'withdrawn'

// 'none' is "we never asked, or they never ticked". Deliberately distinct from
// 'withdrawn', which is a positive act somebody has to be able to show we
// honoured.
export type ConsentState = 'none' | 'granted' | 'confirmed' | 'withdrawn'

export const CONSENT_BUSINESS_NAME_MAX = 200

// The checkbox label. The <label> element must wrap ONLY this string and the
// input. The notice below is a sibling, wired up with aria-describedby, so that
// clicking the explanation cannot toggle the box.
const LABEL: Record<ConsentLocale, (businessName: string) => string> = {
  de: (b) =>
    `Ja, ${b} darf mir zu diesem Gespräch eine E-Mail schreiben, auch wenn ich heute keinen Termin buche.`,
  en: (b) =>
    `Yes, ${b} may email me about this conversation, even if I do not book an appointment today.`,
}

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

// What the form posts back when the box is ticked: a claim about what was on
// screen. The server rebuilds the same text from its own copy and refuses the
// row if the two disagree.
export interface ConsentSubmission {
  notice_version: string
  locale: ConsentLocale
  rendered_business_name: string
}

// Returns null when there is nothing safe to render — no business name yet (the
// intro probe has not resolved), or a name too long to be real. The caller must
// then render NO checkbox at all: a consent box that names no sender is not a
// consent box.
export function buildConsentNotice(
  version: string,
  locale: ConsentLocale,
  businessName: string | null | undefined,
): ConsentNotice | null {
  if (version !== CONSENT_NOTICE_VERSION) return null
  if (locale !== 'de' && locale !== 'en') return null
  const name = typeof businessName === 'string' ? businessName.trim() : ''
  if (!name || name.length > CONSENT_BUSINESS_NAME_MAX) return null
  return {
    version,
    locale,
    label: LABEL[locale](name),
    notice: NOTICE[locale](name),
    rendered_business_name: name,
  }
}

// Build the payload to send with the contact form. Returns null when the box is
// unticked OR when the notice could not be rendered — an unticked box and a
// missing box must be indistinguishable on the wire, so the server treats both
// as "no consent" and stores nothing.
export function buildConsentSubmission(
  ticked: boolean,
  notice: ConsentNotice | null,
): ConsentSubmission | null {
  if (!ticked || !notice) return null
  return {
    notice_version: notice.version,
    locale: notice.locale,
    rendered_business_name: notice.rendered_business_name,
  }
}

// ---------------------------------------------------------------------------
// Reading state (mirror of the Deno copy's derivation)
// ---------------------------------------------------------------------------
//
// The header above says the evidence logic is deliberately NOT mirrored, and
// that still holds for everything that WRITES. These two only READ, and the
// coach's dashboard needs them: it has to show a visitor's consent state next to
// their conversation. Nothing here can produce, alter or authorise a row — the
// send path gates on the server's own derivation, never on this one.
//
// Keep the semantics identical to supabase/functions/_shared/consent.ts. If the
// two ever disagree, a coach reads one answer off the screen while the sender
// acts on another, which is the single worst failure this feature can have.

// The subject key of a consent is (concierge_id, visitor_email_norm), never the
// conversation. Lowercase + trim only: no dot-stripping, no plus-stripping.
// Those are Gmail conventions, not RFC ones, and folding a+b@x.de into a@x.de
// would bind one person's consent to a different mailbox.
export function normalizeConsentEmail(email: string): string {
  return email.trim().toLowerCase()
}

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
