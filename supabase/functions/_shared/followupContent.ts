// The follow-up mail itself: the one email a confirmed consent buys.
//
// This is consentMail.ts's sibling and its opposite. That mail may carry NO
// offer, because it is sent to an address that has not confirmed anything yet.
// This one is sent only after the visitor clicked the link in that mail, so it
// is allowed to carry the one thing the whole chain exists for: the coach's
// booking link, once more, in the coach's name.
//
// Allowed is not the same as unbounded. Four things constrain every line below.
//
// 1. WE DO NOT KNOW WHETHER THEY BOOKED, AND THE MAIL MUST NEVER PRETEND WE DO.
//    The calendar is an external URL (concierges.calendar_url) that the chat
//    opens in a new tab. Nothing in this product observes that tab. Learning
//    whether a click became an appointment would mean proxying or instrumenting
//    the coach's own booking page, which we do not do and would have to disclose
//    if we did. So there is no "du hast noch nicht gebucht", no "dein Platz ist
//    noch frei", no nudge of any kind. The mail hands over the link again and
//    says, in as many words, that a visitor who already has an appointment has
//    nothing to do here. Every sentence has to read correctly to BOTH readers,
//    and the tests below check the ones that could drift.
//
// 2. THE SENDER IS THE COACH, SO THE WORD "WIR" IS BANNED FROM THE GERMAN COPY.
//    The From line reads "<Coach> via 2Fronts" and the Reply-To is the coach's
//    own mailbox (20260809100000). A "wir" in that mail has no referent: the
//    reader cannot tell whether the coach or 2Fronts is speaking, and §7 Abs. 2
//    Nr. 4 UWG is precisely about not concealing who the sender is. Everything
//    the coach does is written as ${business_name}; the single sentence 2Fronts
//    says about itself names 2Fronts.
//
// 3. ONE MAIL, AND THE MAIL SAYS SO. The consent notice the visitor read
//    (consent.ts NOTICE) promises "eine einzige E-Mail". FOLLOWUP_ONE_MAIL_SENTENCE
//    repeats that promise inside the mail. It is a claim about our behaviour, and
//    what keeps it is a partial unique index, not anyone's good intentions:
//    concierge_followup_outbox_one_sent_per_recipient_idx on
//    (concierge_id, email_normalized) `where status = 'sent'` (20260812100000).
//    Partial, so a failed row can be re-enqueued; keyed on the MAILBOX rather
//    than the conversation, because a visitor with two tabs is two conversations
//    and one inbox, and the promise was about their inbox.
//
// 4. LINKS. Exactly three are allowed and each is here for a reason: the booking
//    link (the point), the coach's privacy URL (Art. 13 DSGVO, the coach is the
//    Verantwortlicher, ours does not substitute) and the unsubscribe link (§7
//    Abs. 2 Nr. 4 UWG: a route to stop the sending at no cost beyond
//    transmission; the send path should put the same URL in List-Unsubscribe).
//    Everything else a coach can type -- business name, sender block, the free
//    note -- goes through stripLinks(), copied from consentMail for the same
//    reason it exists there: a coach who names their business "Angebot:
//    https://..." must not be able to append a fourth link to a mail whose link
//    budget is a legal argument.
//
// GERMAN HOUSE STYLE (enforced by the tests): du-form, verbs rather than
// nominalisations, mixed sentence lengths, no em dash and no en dash anywhere.
// And the standing copy rule: no absolute grounding claims. The words "nur",
// "erfindet nie" and "Halluzin*" do not appear in either body, because grounding
// is a prompt instruction and not a guarantee we can make in a coach's name.

import type { ConsentLocale } from './consent.ts'
import { escapeAttr, escapeHtml } from './consentPage.ts'

// ---------------------------------------------------------------------------
// clampLanguage -- first, because everything else reads its result
// ---------------------------------------------------------------------------

/**
 * concierges.language -> a locale this module has copy for.
 *
 * THE COLUMN HAS NO CHECK CONSTRAINT. It is written by the setup wizard and by
 * concierge-draft-from-url, and nothing in the schema stops a row from holding
 * 'DE', 'fr', '' or null. concierge-chat already clamps at its own read
 * (concierge-chat/index.ts:950, "clamp rather than trust") and this module makes
 * the same move for the same reason, one step further downstream: an unclamped
 * value would index into the COPY record and produce `undefined`, so the mail
 * would either throw inside a queue worker or, worse, go out with the literal
 * word "undefined" in a sentence signed with the coach's name.
 *
 * The comparison is deliberately exact and NOT case-folded, byte-for-byte the
 * same test concierge-chat makes. A row holding 'EN' gets a German chat today;
 * if this function case-folded, the same row would get a German chat and an
 * English mail, and the mail must speak the language the conversation spoke.
 * The place to fix 'EN' is the write path or a CHECK constraint, not here.
 */
export function clampLanguage(raw: unknown): ConsentLocale {
  return raw === 'en' ? 'en' : 'de'
}

// ---------------------------------------------------------------------------
// sanitizeVisitorName
// ---------------------------------------------------------------------------

// Counted in code points, not UTF-16 units, so an astral character costs one.
const VISITOR_NAME_MAX = 60

// C0 controls, DEL and C1. CR and LF are in this set, which is the header-safety
// half of the job; the rest are simply not things that belong in a greeting.
const CONTROL_CHARS = /\p{Cc}/u

/**
 * The visitor's own name, as they typed it into the contact form, for the
 * greeting line. Returns null when the value is not usable as one, and the
 * caller then greets without a name. Never throws.
 *
 * WHAT IT REJECTS, AND WHY EXACTLY THIS LIST:
 *   - control characters, CR, LF: the classic header-injection payload
 *     ("Max\r\nBcc: x@y.z"). This body line is not where that attack lands, but
 *     the same string is the obvious candidate for a To: display name later, and
 *     a value that could never be safe there should not be circulating.
 *   - '@': a name that is an address is a form-fill error or a probe, and it
 *     would render as "Hallo mallory@evil.test," in a mail signed by the coach.
 *   - '<' and '>': address-literal shape, same reason.
 *   - over 60 code points: a greeting, not a paste buffer.
 *   - not starting with a letter (\p{L}): drops empty strings, quotes, dashes,
 *     emoji openers and the "-- " a bot leaves behind, without judging what
 *     comes after the first character.
 *
 * WHAT IT DOES NOT DO, AND THIS IS THE WHOLE POINT: it does not filter the name
 * through an allow-list of letters and marks. That is the obvious
 * implementation and it is wrong. "Max 2" (a real thing people type when a
 * form rejects their first attempt), "Anna-Lena O'Brien", "José Müller",
 * "Ana Sánchez-Ruiz", "H. Özdemir", "Jean-Luc de la Tour" all fail a
 * letters-and-marks-only test on the space, the hyphen, the apostrophe or the
 * full stop. Every one of those would silently become "Hallo," -- a mail that
 * greets a customer of the coach by not greeting them, in the coach's name,
 * with nobody ever seeing the degradation. The injection risk lives in how the
 * From/To headers are BUILT, not in a line of body text, and defending it here
 * with a character allow-list buys a smaller amount of safety than it costs in
 * mail that reads like a mail merge that broke.
 *
 * So: trim, apply the five rejections above, and otherwise print what the person
 * typed. The value reaches the HTML as a text node only -- never an attribute,
 * never a URL, never a header -- so escapeHtml() is the complete defence there.
 *
 * Known and accepted: a name shaped like "https://x.test" passes (it starts with
 * a letter). It is not a smuggling vector, because this mail goes to the one
 * mailbox that typed the name, and the greeting is not a place a stranger's text
 * can reach a third party.
 */
export function sanitizeVisitorName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (!name) return null
  if (CONTROL_CHARS.test(name)) return null
  if (name.includes('@') || name.includes('<') || name.includes('>')) return null
  if ([...name].length > VISITOR_NAME_MAX) return null
  if (!/^\p{L}/u.test(name)) return null
  return name
}

// ---------------------------------------------------------------------------
// Coach-controlled free text
// ---------------------------------------------------------------------------

const BUSINESS_NAME_MAX = 200
const SENDER_BLOCK_MAX_LINES = 8
const SENDER_BLOCK_MAX_CHARS = 400
const NOTE_MAX_LINES = 6
const NOTE_MAX_CHARS = 600

// Identical to consentMail.stripLinks, deliberately duplicated rather than
// exported across: the two mails have different link budgets (zero there, three
// here) and a shared helper would invite a future edit that loosens one budget
// while meaning the other.
function stripLinks(value: string): string {
  return value.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
}

function cleanBusinessName(raw: string): string {
  const cleaned = stripLinks(raw).replace(/\s+/g, ' ').trim()
  return cleaned.length > BUSINESS_NAME_MAX ? cleaned.slice(0, BUSINESS_NAME_MAX).trim() : cleaned
}

// Keeps line structure, drops lines that were only a URL, bounds the whole.
function cleanBlock(raw: string | null | undefined, maxLines: number, maxChars: number): string[] {
  if (typeof raw !== 'string') return []
  const lines: string[] = []
  let budget = maxChars
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = stripLinks(line).replace(/[ \t]+/g, ' ').trim()
    if (!cleaned) continue
    if (cleaned.length > budget) break
    budget -= cleaned.length
    lines.push(cleaned)
    if (lines.length >= maxLines) break
  }
  return lines
}

// The same posture as consentMail's confirm-URL check: https, or http on
// loopback so local runs work, and nothing that could break out of an href.
function safeUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const url = raw.trim()
  if (!url) return null
  if (!/^https:\/\/|^http:\/\/(?:localhost|127\.0\.0\.1)(?:[:/]|$)/i.test(url)) return null
  if (url.includes('"') || url.includes("'") || url.includes('<') || url.includes('>')) return null
  if (/\s/.test(url)) return null
  return url
}

// ---------------------------------------------------------------------------
// The row and the input
// ---------------------------------------------------------------------------

export interface FollowupMailConcierge {
  business_name: string
  language?: string | null
  /**
   * The booking link. consentMail declares this column and refuses to read it;
   * printing it is what THIS module is for, and the difference between the two
   * files is the difference between an unconfirmed and a confirmed address.
   */
  calendar_url?: string | null
  /** §5 DDG. Printed verbatim apart from stripLinks and the caps above. */
  followup_sender_block?: string | null
  /** Art. 13 DSGVO, the coach's own notice. Required: see buildFollowupMail. */
  followup_privacy_url?: string | null
}

export interface FollowupMailInput {
  concierge: FollowupMailConcierge
  /**
   * The one-click withdrawal link, already signed by the caller. Required. A
   * commercial mail without a working route out is the §7 Abs. 2 Nr. 4 UWG
   * violation this whole chain was built to avoid, so "no URL" means "no mail",
   * never "send it anyway".
   */
  unsubscribeUrl: string
  /** From the contact row. Passed raw; sanitizeVisitorName runs here. */
  visitorName?: string | null
  /**
   * One optional line or two the coach wrote in the wizard, e.g. what to bring
   * to the call. Free text, so it is stripped and bounded like the sender block.
   */
  coachNote?: string | null
  /**
   * The locale of the consent that was given, from the stored snapshot. Falls
   * back to the row's own language, clamped. The mail must speak the language
   * the notice was read in, not today's default.
   */
  locale?: ConsentLocale
}

export interface FollowupMail {
  subject: string
  text: string
  html: string
}

// ---------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------

export const FOLLOWUP_MAIL_SUBJECT: Record<ConsentLocale, (businessName: string) => string> = {
  de: (b) => `Der Kalenderlink von ${b}`,
  en: (b) => `The calendar link from ${b}`,
}

/**
 * The sentence that closes the loop the consent notice opened. Exported so a
 * test can assert it survives and so nobody can quietly turn this mail into the
 * first of a sequence. It is true because of
 * concierge_followup_outbox_one_sent_per_recipient_idx: unique on
 * (concierge_id, email_normalized) `where status = 'sent'`, so a second send to
 * the same mailbox is a constraint violation, not a policy someone remembers.
 */
export const FOLLOWUP_ONE_MAIL_SENTENCE: Record<ConsentLocale, string> = {
  de: 'Das ist die einzige E-Mail zu diesem Gespräch. Danach kommt nichts mehr.',
  en: 'This is the only email about this conversation. Nothing else follows.',
}

/**
 * The sentence that has to read correctly to someone who booked ten minutes
 * after the chat AND to someone who never opened the calendar. Exported for the
 * same reason: it is the one line a well-meaning edit would turn into a nudge.
 */
export const FOLLOWUP_NEUTRAL_CLOSING: Record<ConsentLocale, string> = {
  de: 'Steht dein Termin schon, ist hier nichts zu tun.',
  en: 'If your appointment is already booked, there is nothing to do here.',
}

interface Copy {
  greeting: string
  recall: string
  linkLead: string
  linkLabel: string
  closing: string
  oneMail: string
  processor: string
  privacyLead: string
  unsubscribeLead: string
}

const COPY: Record<ConsentLocale, (businessName: string, visitorName: string | null) => Copy> = {
  de: (b, n) => ({
    greeting: n ? `Hallo ${n},` : 'Hallo,',
    recall: `du hast im Chat von ${b} geschrieben.`,
    linkLead: 'Hier ist der Link zum Kalender noch einmal, falls du ihn brauchst:',
    linkLabel: 'Kalender öffnen',
    closing: FOLLOWUP_NEUTRAL_CLOSING.de,
    oneMail: FOLLOWUP_ONE_MAIL_SENTENCE.de,
    processor: `2Fronts verschickt diese E-Mail im Auftrag von ${b}.`,
    privacyLead: `Wie ${b} mit deinen Daten umgeht, steht hier:`,
    unsubscribeLead: 'Du kannst deine Einwilligung jederzeit widerrufen, mit einem Klick:',
  }),
  en: (b, n) => ({
    greeting: n ? `Hello ${n},` : 'Hello,',
    recall: `you wrote to ${b} in the chat.`,
    linkLead: 'Here is the calendar link again, in case you need it:',
    linkLabel: 'Open the calendar',
    closing: FOLLOWUP_NEUTRAL_CLOSING.en,
    oneMail: FOLLOWUP_ONE_MAIL_SENTENCE.en,
    processor: `2Fronts sends this email on behalf of ${b}.`,
    privacyLead: `How ${b} handles your data is explained here:`,
    unsubscribeLead: 'You can withdraw your consent at any time, with one click:',
  }),
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the follow-up mail.
 *
 * Returns null when there is nothing lawful or useful to send, and the caller
 * must treat null as "do not send", never as "send something simpler":
 *   - no business name left after stripping links (nobody to sign it),
 *   - no usable booking link (the mail's only purpose),
 *   - no privacy URL (Art. 13, the coach is the controller),
 *   - no usable unsubscribe URL (§7 Abs. 2 Nr. 4 UWG).
 * The send path checks the same preconditions against the row before it ever
 * gets here; this is the second, mechanical answer to the same question.
 */
export function buildFollowupMail(input: FollowupMailInput): FollowupMail | null {
  // Clamped first, before any lookup that a raw column value could miss.
  const locale: ConsentLocale = input.locale ?? clampLanguage(input.concierge.language)

  const business = cleanBusinessName(input.concierge.business_name ?? '')
  if (!business) return null

  const bookingUrl = safeUrl(input.concierge.calendar_url)
  if (!bookingUrl) return null

  const privacyUrl = safeUrl(input.concierge.followup_privacy_url)
  if (!privacyUrl) return null

  const unsubscribeUrl = safeUrl(input.unsubscribeUrl)
  if (!unsubscribeUrl) return null

  const visitorName = sanitizeVisitorName(input.visitorName)
  const c = COPY[locale](business, visitorName)
  const noteLines = cleanBlock(input.coachNote, NOTE_MAX_LINES, NOTE_MAX_CHARS)
  const senderLines = cleanBlock(input.concierge.followup_sender_block, SENDER_BLOCK_MAX_LINES, SENDER_BLOCK_MAX_CHARS)

  // --- plain text ---------------------------------------------------------
  const textParts: string[] = [
    c.greeting,
    '',
    c.recall,
    '',
    c.linkLead,
    bookingUrl,
  ]
  if (noteLines.length > 0) textParts.push('', ...noteLines)
  textParts.push('', c.closing, '', c.oneMail)
  if (senderLines.length > 0) textParts.push('', ...senderLines)
  textParts.push(
    '',
    c.processor,
    '',
    c.privacyLead,
    privacyUrl,
    '',
    c.unsubscribeLead,
    unsubscribeUrl,
  )
  const text = `${textParts.join('\n')}\n`

  // --- html ---------------------------------------------------------------
  //
  // The booking URL appears ONCE, in the href of the one button. A visible copy
  // beside it would be a second occurrence and the tests count occurrences, so
  // the "one booking link" claim stays mechanically true rather than reviewed.
  //
  // Der Rundgang inside a mail client: linen ground, one pane, hairline edge,
  // zero radius, the lamp on the single action. No shadow -- the lamp glow is an
  // rgba box-shadow that Outlook drops, and flat is the honest degradation.
  const noteHtml = noteLines.length > 0
    ? `\n      <p style="margin:0 0 1.25rem;padding:0 0 0 0.9rem;border-left:2px solid #cec2ad;">${
      noteLines.map((l) => escapeHtml(l)).join('<br>')
    }</p>`
    : ''

  const senderHtml = senderLines.length > 0
    ? `\n      <p style="margin:1.5rem 0 0;color:#56503f;font-size:0.85rem;line-height:1.6;">${
      senderLines.map((l) => escapeHtml(l)).join('<br>')
    }</p>`
    : ''

  const html = `<!doctype html>
<html lang="${escapeAttr(locale)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(FOLLOWUP_MAIL_SUBJECT[locale](business))}</title>
</head>
<body style="margin:0;padding:0;background:#e7dfd0;">
  <div style="margin:0 auto;max-width:34rem;padding:2rem 1.25rem;background:#e7dfd0;color:#17130f;font-family:Archivo,'Segoe UI',system-ui,sans-serif;font-size:1.05rem;line-height:1.6;">
    <div style="background:#f3ede1;border:1px solid #cec2ad;padding:1.75rem;">
      <p style="margin:0 0 1rem;">${escapeHtml(c.greeting)}</p>
      <p style="margin:0 0 1rem;">${escapeHtml(c.recall)}</p>
      <p style="margin:0 0 1rem;">${escapeHtml(c.linkLead)}</p>
      <p style="margin:0 0 1.25rem;">
        <a href="${escapeAttr(bookingUrl)}" style="display:inline-block;background:#d2a244;border:1px solid #9c7420;border-radius:0;color:#17130f;font-family:'Familjen Grotesk','Segoe UI',system-ui,sans-serif;font-size:1.05rem;font-weight:700;padding:0.85rem 1.6rem;text-decoration:none;">${
    escapeHtml(c.linkLabel)
  }</a>
      </p>${noteHtml}
      <p style="margin:0 0 1rem;">${escapeHtml(c.closing)}</p>
      <p style="margin:0 0 1rem;color:#56503f;">${escapeHtml(c.oneMail)}</p>
      <p style="margin:0;color:#56503f;font-size:0.85rem;">${escapeHtml(c.processor)}</p>${senderHtml}
      <p style="margin:1.5rem 0 0;color:#56503f;font-size:0.85rem;">${escapeHtml(c.privacyLead)}<br>
        <a href="${escapeAttr(privacyUrl)}" style="color:#56503f;">${escapeHtml(privacyUrl)}</a>
      </p>
      <p style="margin:0.75rem 0 0;color:#56503f;font-size:0.85rem;">${escapeHtml(c.unsubscribeLead)}<br>
        <a href="${escapeAttr(unsubscribeUrl)}" style="color:#56503f;">${escapeHtml(unsubscribeUrl)}</a>
      </p>
    </div>
  </div>
</body>
</html>
`

  return { subject: FOLLOWUP_MAIL_SUBJECT[locale](business), text, html }
}
