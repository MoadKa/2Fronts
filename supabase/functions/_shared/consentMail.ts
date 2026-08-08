// The double-opt-in mail, and the signed link inside it.
//
// THIS MAIL IS CONTENT-FREE, AND THAT IS A LEGAL REQUIREMENT, NOT A STYLE
// CHOICE.
//
// A confirmation mail is sent to an address whose owner has not yet confirmed
// anything. Until they click, we hold no usable consent for that mailbox. So
// the mail itself may not advertise: the BGH's Payback line and the standing
// reading of §7 Abs. 2 Nr. 3 UWG treat an opt-in mail that also carries an
// offer as an unsolicited advertisement in its own right (LG Berlin and OLG
// München have both struck "confirmation" mails that carried a greeting from
// the advertiser and a link to the shop). The mechanism built to establish
// consent would then be the first violation of it, and the whole ledger under
// consent.ts would document nothing but our own liability.
//
// Therefore, structurally, not merely by convention:
//
//   - buildConsentMail is NEVER handed the coach's offer, tone, q&a or
//     conversation. It takes a narrow view of the concierge row, and the row's
//     `calendar_url` is accepted into the type but read by nothing, so the
//     tests can prove that passing one changes no byte of the output.
//   - stripLinks() removes every URL from the two free-text values a coach
//     controls (business name, sender block), so the confirm link is the only
//     link the mail can contain, whatever anyone types into the wizard.
//   - There is one call to action and it is "confirm". No booking, no reply
//     invitation, no postscript.
//
// GERMAN HOUSE STYLE (enforced by the tests): du-form, verbs rather than
// nominalisations, short sentences, no em dash and no en dash anywhere, no
// marketing vocabulary.
//
// THE LINK. `t` is the row's `confirm_token` plus an HMAC of it:
//
//     t = <confirm_token>.<b64url(HMAC-SHA256(confirm_token, secret))>
//
// The signature is not a second secret for the visitor, it is a doorman for the
// database. Without it, anyone could make the confirm endpoint run a lookup per
// guess; with it, a forged `t` is rejected by arithmetic alone and no row is
// ever read. The expiry deliberately stays in the DB column
// (`confirm_token_expires_at`) rather than in the signature, because a value in
// the row can be shortened or revoked after the mail has left, and a value
// inside a signature cannot.
//
// The b64url / hmac / safeEqual helpers are copied from oauthState.ts rather
// than imported: that module is the OAuth CSRF story and owns a cookie name and
// a TTL that have nothing to do with consent. Two twelve-line primitives are a
// cheaper dependency than a shared module that both flows would then have to
// agree about.

import type { ConsentLocale } from './consent.ts'
import { escapeAttr, escapeHtml } from './consentPage.ts'

// --------------------------------------------------------------------------
// The signed confirm link
// --------------------------------------------------------------------------

export const CONFIRM_TOKEN_PARAM = 't'

// A confirm_token is base64url and carries no dots, so splitting the envelope
// on '.' is unambiguous. The bounds are sanity bounds: they let the endpoint
// discard nonsense before it spends a hash, and they cap what an attacker can
// make us hash per request.
const CONFIRM_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/
const SIGNATURE_RE = /^[A-Za-z0-9_-]{16,64}$/
export const CONFIRM_PARAM_MAX_LEN = 200

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
  return b64url(sig)
}

// Constant-time-ish compare (no early exit on the first differing byte).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * The value of the `t` query parameter: token plus signature.
 * Returns null for an unusable token or a missing secret — a caller that gets
 * null must not send a mail, because the link in it could never be confirmed.
 */
export async function signConfirmToken(confirmToken: string, secret: string): Promise<string | null> {
  if (!secret || !CONFIRM_TOKEN_RE.test(confirmToken)) return null
  return `${confirmToken}.${await hmac(confirmToken, secret)}`
}

/**
 * The inverse. Returns the bare confirm_token when the envelope is well-formed
 * and correctly signed, otherwise null. Fails closed on everything: no secret,
 * wrong shape, oversized input, bad signature.
 */
export async function verifyConfirmToken(raw: string | null, secret: string): Promise<string | null> {
  if (!raw || !secret) return null
  if (raw.length > CONFIRM_PARAM_MAX_LEN) return null
  const parts = raw.split('.')
  if (parts.length !== 2) return null
  const [token, sig] = parts
  if (!CONFIRM_TOKEN_RE.test(token) || !SIGNATURE_RE.test(sig)) return null
  const expected = await hmac(token, secret)
  return safeEqual(expected, sig) ? token : null
}

/**
 * The full URL that goes in the mail.
 *
 * `endpointUrl` is the deployed function's public URL, e.g.
 * `https://<ref>.supabase.co/functions/v1/concierge-consent-confirm`. Returns
 * null rather than throwing: mail building sits on a best-effort path and must
 * never take down the request that triggered it.
 *
 * Plain http is refused except on loopback, mirroring appUrl.ts's posture. A
 * confirm token travelling over http is a consent anyone on the path can spend.
 */
export async function buildConfirmUrl(
  endpointUrl: string,
  confirmToken: string,
  secret: string,
): Promise<string | null> {
  const signed = await signConfirmToken(confirmToken, secret)
  if (!signed) return null
  let parsed: URL
  try {
    parsed = new URL(endpointUrl.trim())
  } catch {
    return null
  }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) return null
  parsed.hash = ''
  parsed.searchParams.set(CONFIRM_TOKEN_PARAM, signed)
  return parsed.toString()
}

// --------------------------------------------------------------------------
// The mail
// --------------------------------------------------------------------------

// The narrow view of a concierge row this module accepts. `calendar_url` is
// declared and never read: it is here so a caller can hand over the row it
// already has, and so a test can prove that doing so puts no booking link in a
// mail that is not allowed to carry one.
export interface ConsentMailConcierge {
  business_name: string
  language?: string | null
  /** Present on the row, deliberately unused. See the module header. */
  calendar_url?: string | null
  /**
   * concierges.followup_sender_block: the coach's legal name and summonable
   * postal address (§5 DDG). Rendered verbatim apart from stripLinks() and the
   * caps below, because an address shape we reformat is an address we got
   * wrong.
   *
   * OPTIONAL HERE, AND ONLY HERE. The send path requires it (along with a
   * verified reply-to, a privacy URL and the coach's acknowledgement) before
   * any follow-up may go out. This mail carries no offer, so it is not the
   * kommerzielle Kommunikation that §5 DDG attaches to, and refusing to send it
   * for a missing block would break the very step that establishes consent.
   * Printed when we have it, skipped when we do not.
   */
  followup_sender_block?: string | null
}

export interface ConsentMailInput {
  concierge: ConsentMailConcierge
  /** Built by buildConfirmUrl. Must already be signed. */
  confirmUrl: string
  /**
   * The language of the consent that was given, from the stored snapshot.
   * Falls back to the concierge's own language. The mail must speak the
   * language the notice was read in, not today's default.
   */
  locale?: ConsentLocale
}

export interface ConsentMail {
  subject: string
  text: string
  html: string
}

export const CONSENT_MAIL_SUBJECT: Record<ConsentLocale, string> = {
  de: 'Bitte bestätige deine E-Mail-Adresse',
  en: 'Please confirm your email address',
}

// The sentence the whole double opt-in turns on: silence costs the visitor
// nothing. Exported so a test can assert it survives, and so nobody can
// "improve" it into a nudge.
export const CONSENT_MAIL_IGNORE_SENTENCE: Record<ConsentLocale, string> = {
  de: 'Wenn du nichts tust, passiert nichts und du bekommst keine weitere E-Mail.',
  en: 'If you do nothing, nothing happens and you will not get another email.',
}

const LINK_LABEL: Record<ConsentLocale, string> = {
  de: 'E-Mail-Adresse bestätigen',
  en: 'Confirm email address',
}

const SENDER_BLOCK_MAX_LINES = 8
const SENDER_BLOCK_MAX_CHARS = 400
const BUSINESS_NAME_MAX = 200

// Remove anything a mail client would turn into a link. The confirm link is
// added by this module alone; a URL that arrives through a coach-controlled
// free-text field is exactly the "advertising in the opt-in mail" the header
// forbids, and a coach who names their business "Jetzt buchen: https://..."
// must not be able to smuggle one in.
function stripLinks(value: string): string {
  return value.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
}

function cleanBusinessName(raw: string): string {
  const cleaned = stripLinks(raw).replace(/\s+/g, ' ').trim()
  return cleaned.length > BUSINESS_NAME_MAX ? cleaned.slice(0, BUSINESS_NAME_MAX).trim() : cleaned
}

// Keeps the line structure of an address block, drops any line that was only a
// URL, and bounds the whole thing.
function cleanSenderBlock(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string') return []
  const lines: string[] = []
  let budget = SENDER_BLOCK_MAX_CHARS
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = stripLinks(line).replace(/[ \t]+/g, ' ').trim()
    if (!cleaned) continue
    if (cleaned.length > budget) break
    budget -= cleaned.length
    lines.push(cleaned)
    if (lines.length >= SENDER_BLOCK_MAX_LINES) break
  }
  return lines
}

interface Copy {
  intro: string
  ask: string
  linkLead: string
  ignore: string
  onlyThis: string
  processor: string
}

const COPY: Record<ConsentLocale, (businessName: string) => Copy> = {
  de: (b) => ({
    intro: `du hast bei ${b} angegeben, dass ${b} dir zu eurem Gespräch eine E-Mail schreiben darf.`,
    ask: 'Bitte bestätige, dass diese Adresse dir gehört.',
    linkLead: 'Klicke dazu auf diesen Link:',
    ignore: CONSENT_MAIL_IGNORE_SENTENCE.de,
    onlyThis: 'Mehr steht in dieser E-Mail nicht. Wir fragen nur nach, ob die Adresse stimmt.',
    processor: `2Fronts verschickt diese E-Mail im Auftrag von ${b}.`,
  }),
  en: (b) => ({
    intro: `you told ${b} that ${b} may send you an email about your conversation.`,
    ask: 'Please confirm that this address belongs to you.',
    linkLead: 'To do that, click this link:',
    ignore: CONSENT_MAIL_IGNORE_SENTENCE.en,
    onlyThis: 'There is nothing else in this email. We are only asking whether the address is right.',
    processor: `2Fronts sends this email on behalf of ${b}.`,
  }),
}

const GREETING: Record<ConsentLocale, string> = { de: 'Hallo,', en: 'Hello,' }

/**
 * Build the confirmation mail.
 *
 * Returns null when there is nothing lawful to send: no business name left
 * after cleaning, or a confirm URL that is not an https link we built. Callers
 * must treat null as "do not send", never as "send something simpler".
 */
export function buildConsentMail(input: ConsentMailInput): ConsentMail | null {
  const locale: ConsentLocale = input.locale ?? (input.concierge.language === 'en' ? 'en' : 'de')
  const business = cleanBusinessName(input.concierge.business_name ?? '')
  if (!business) return null

  const url = input.confirmUrl?.trim() ?? ''
  if (!/^https:\/\/|^http:\/\/(?:localhost|127\.0\.0\.1)(?:[:/]|$)/i.test(url)) return null
  if (url.includes('"') || url.includes('<') || url.includes('>') || /\s/.test(url)) return null

  const c = COPY[locale](business)
  const senderLines = cleanSenderBlock(input.concierge.followup_sender_block)

  // --- plain text ---------------------------------------------------------
  const textParts = [
    GREETING[locale],
    '',
    `${c.intro} ${c.ask}`,
    '',
    c.linkLead,
    url,
    '',
    c.ignore,
    '',
    c.onlyThis,
    '',
    c.processor,
  ]
  if (senderLines.length > 0) {
    textParts.push('', ...senderLines)
  }
  const text = `${textParts.join('\n')}\n`

  // --- html ---------------------------------------------------------------
  //
  // The URL appears ONCE, in the href. A visible copy of it next to the link
  // would be a second occurrence, and the tests count occurrences to keep the
  // "one link" claim mechanically true.
  //
  // Der Rundgang, inside the constraints of a mail client: linen ground, hard
  // edges, no radius, the lamp on the one action the visitor came to take. No
  // shadow, because the lamp glow is a rgba box-shadow that Outlook drops and
  // that no mail client renders consistently; flat is the honest degradation.
  const senderHtml = senderLines.length > 0
    ? `\n      <p style="margin:1.5rem 0 0;color:#56503f;font-size:0.85rem;line-height:1.6;">${
      senderLines.map((l) => escapeHtml(l)).join('<br>')
    }</p>`
    : ''

  const html = `<!doctype html>
<html lang="${escapeAttr(locale)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(CONSENT_MAIL_SUBJECT[locale])}</title>
</head>
<body style="margin:0;padding:0;background:#e7dfd0;">
  <div style="margin:0 auto;max-width:34rem;padding:2rem 1.25rem;background:#e7dfd0;color:#17130f;font-family:Archivo,'Segoe UI',system-ui,sans-serif;font-size:1.05rem;line-height:1.6;">
    <div style="background:#f3ede1;border:1px solid #cec2ad;padding:1.75rem;">
      <p style="margin:0 0 1rem;">${escapeHtml(GREETING[locale])}</p>
      <p style="margin:0 0 1rem;">${escapeHtml(`${c.intro} ${c.ask}`)}</p>
      <p style="margin:0 0 1.25rem;">
        <a href="${escapeAttr(url)}" style="display:inline-block;background:#d2a244;border:1px solid #9c7420;border-radius:0;color:#17130f;font-family:'Familjen Grotesk','Segoe UI',system-ui,sans-serif;font-size:1.05rem;font-weight:700;padding:0.85rem 1.6rem;text-decoration:none;">${
    escapeHtml(LINK_LABEL[locale])
  }</a>
      </p>
      <p style="margin:0 0 1rem;">${escapeHtml(c.ignore)}</p>
      <p style="margin:0 0 1rem;color:#56503f;">${escapeHtml(c.onlyThis)}</p>
      <p style="margin:0;color:#56503f;font-size:0.85rem;">${escapeHtml(c.processor)}</p>${senderHtml}
    </div>
  </div>
</body>
</html>
`

  return { subject: CONSENT_MAIL_SUBJECT[locale], text, html }
}
