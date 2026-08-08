// The reply-to verification mail, and the signed link inside it.
//
// COACH-FACING TWIN OF consentMail.ts. That module asks a VISITOR whether the
// address they typed is theirs; this one asks the COACH the same question about
// the address they put in the setup wizard as Reply-To. The two mails are built
// the same way and for overlapping reasons, but they are not the same mail and
// they are not sent to the same person, so they do not share a module.
//
// WHY THE ROUND-TRIP EXISTS AT ALL
//
// §7 Abs. 2 Nr. 4 UWG requires a valid address at which the recipient of a
// commercial mail can demand that the sending stops, at no cost beyond
// transmission, and §5 DDG wants a sender who can actually be reached. A coach
// typing an address into a wizard establishes neither. A typo means every reply
// from their own customer, including "stop writing to me", falls into nothing,
// in a mail that carries the coach's name. So decideSend() refuses to send
// anything while concierges.followup_reply_to_verified_at is null, and this
// mail is the only way that column is ever filled.
//
// THIS MAIL IS CONTENT-FREE, and for the same structural reason consentMail.ts
// is: it is a mail sent to establish that an address works, so it must not also
// be an occasion to say anything else. It is a narrower promise here (the
// recipient is our own paying customer, not a stranger, so §7 Abs. 2 Nr. 3 UWG
// is not the hazard it is over there) but the discipline is kept identical
// anyway, because the day someone adds "by the way, upgrade" to a mail like
// this is the day nobody can tell the two mails apart:
//
//   - buildReplyToVerifyMail is NEVER handed the coach's offer, tone, q&a or
//     conversation. It takes a narrow view of the concierge row, and the row's
//     `calendar_url` is accepted into the type and read by nothing, so a test
//     can prove that passing one changes no byte of the output.
//   - stripLinks() removes every URL from the one free-text value the coach
//     controls (the business name), so the verification link is the only link
//     the mail can contain.
//   - There is one call to action and it is "confirm".
//
// GERMAN HOUSE STYLE (enforced by the tests): du-form, verbs rather than
// nominalisations, short sentences, no em dash and no en dash anywhere, no
// marketing vocabulary.
//
// -----------------------------------------------------------------------
// THE TOKEN BINDS THE CONCIERGE **AND** THE ADDRESS
// -----------------------------------------------------------------------
//
//     t   = v1.<conciergeId>.<addrDigest>.<sig>
//     addrDigest = b64url(HMAC-SHA256("replyto:" + normalized, secret))
//     sig        = b64url(HMAC-SHA256("v1.<conciergeId>.<addrDigest>", secret))
//
// Binding the concierge alone would be a hole with a name: the coach saves
// address A, gets the mail, and then, before clicking, edits the reply-to to
// address B. A token that said only "this concierge's reply-to is verified"
// would stamp the column for B on the strength of a mail that only ever reached
// A. The verification would then assert exactly the thing it never tested. So
// the endpoint recomputes the digest from whatever address the row holds RIGHT
// NOW and refuses anything that does not match: changing the address silently
// invalidates every link already in flight, which is the behaviour the column
// comment ("when we proved the coach actually controls followup_reply_to")
// claims.
//
// THE ADDRESS IS IN THE TOKEN AS A KEYED DIGEST, NOT IN THE CLEAR. The same
// argument followupToken.ts makes about a visitor's address applies, if less
// sharply, to the coach's: a URL out of a mail gets pasted into support
// tickets, prefetched by scanners and written to every proxy log on the way.
// The digest is HMAC-keyed rather than a plain SHA-256 so that a leaked URL
// cannot be run against a list of candidate addresses offline; without the
// secret it is not a hash of anything guessable.
//
// NO EXPIRY IN THE TOKEN. There is nothing an expiry would protect. The link
// grants exactly one thing (stamp a column whose value the coach can invalidate
// themselves by changing the address), it is invalidated by that change anyway,
// and a coach who verifies three weeks late is a coach who verified. What an
// expiry WOULD do is turn a slow inbox into a permanently un-sendable queue with
// no visible cause.
//
// The b64url / hmac / safeEqual helpers are copied from oauthState.ts rather
// than imported, exactly as consentMail.ts and followupToken.ts copied them, and
// for the same reason: that module owns a cookie name and a TTL that have
// nothing to do with this flow.

import type { ConsentLocale } from './consent.ts'
import { escapeAttr, escapeHtml } from './consentPage.ts'

// --------------------------------------------------------------------------
// The signed verification link
// --------------------------------------------------------------------------

export const REPLY_TO_VERIFY_TOKEN_PARAM = 't'

// The version tag exists so a future format change can be rolled out without
// guessing: an unknown prefix is refused before a hash is spent.
export const REPLY_TO_VERIFY_TOKEN_VERSION = 'v1'

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
// b64url of a SHA-256 digest, unpadded, is exactly 43 characters. Both the
// address digest and the signature are one.
const DIGEST_RE = /^[A-Za-z0-9_-]{43}$/

// v1(2) + 3 dots + 36 + 43 + 43 = 127. The cap is what stops an attacker making
// us hash a megabyte per request; it is not a format check.
export const REPLY_TO_VERIFY_PARAM_MAX_LEN = 256

// RFC 5321's maximum path length. An address longer than this is not one we
// could have stored (concierge-setup caps at the same number), so refusing it
// before hashing costs nothing.
const REPLY_TO_MAX = 320

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
 * The comparison form of an address. Same rule as normalizeConsentEmail: trim
 * and lowercase, nothing cleverer.
 *
 * Written here rather than imported from consent.ts because that module is the
 * VISITOR consent ledger and its normalisation is part of a stored column's
 * meaning; this one only ever feeds a digest. Two one-line functions that agree
 * today are cheaper than a shared one that both domains have to keep agreeing
 * about, and if they ever diverge the divergence is local and visible.
 */
export function normalizeReplyTo(address: string): string {
  return address.trim().toLowerCase()
}

/**
 * The keyed digest of an address. Exported because the ENDPOINT needs it: it
 * recomputes this from the address currently in the row and compares it against
 * the one the token carries. That comparison is the whole address binding.
 *
 * Returns null for a missing secret or an unusable address, so a caller can
 * never accidentally compare "null equals null" into a pass.
 */
export async function replyToDigest(address: string, secret: string): Promise<string | null> {
  if (!secret) return null
  const normalized = normalizeReplyTo(address ?? '')
  if (!normalized || normalized.length > REPLY_TO_MAX) return null
  return await hmac(`replyto:${normalized}`, secret)
}

/** What a valid token proves: which setter, and which address. */
export interface ReplyToVerifyClaim {
  conciergeId: string
  /** The keyed digest, NOT the address. See the module header. */
  addressDigest: string
}

function payload(conciergeId: string, addressDigest: string): string {
  return `${REPLY_TO_VERIFY_TOKEN_VERSION}.${conciergeId}.${addressDigest}`
}

/**
 * The value of the `t` query parameter.
 *
 * Returns null when there is no secret, the concierge id is not a UUID, or the
 * address cannot be digested. A caller that gets null MUST NOT SEND THE MAIL: a
 * verification mail whose link cannot be built is a mail that asks the coach to
 * click something that can never work.
 */
export async function signReplyToVerifyToken(
  conciergeId: string,
  replyTo: string,
  secret: string,
): Promise<string | null> {
  if (!secret || !UUID_RE.test(conciergeId)) return null
  const digest = await replyToDigest(replyTo, secret)
  if (!digest) return null
  const message = payload(conciergeId, digest)
  return `${message}.${await hmac(message, secret)}`
}

/**
 * The inverse. Returns the claim when the token is well-formed and correctly
 * signed, otherwise null.
 *
 * Fails closed on everything: no secret, oversized input, unknown version, a
 * non-UUID id, a wrong-shaped digest or signature, a bad signature. Callers rely
 * on null meaning "touch no database", so nothing in here may reach for one.
 */
export async function verifyReplyToVerifyToken(
  raw: string | null | undefined,
  secret: string,
): Promise<ReplyToVerifyClaim | null> {
  if (!raw || !secret) return null
  if (raw.length > REPLY_TO_VERIFY_PARAM_MAX_LEN) return null

  const parts = raw.split('.')
  if (parts.length !== 4) return null
  const [version, conciergeId, addressDigest, sig] = parts
  if (version !== REPLY_TO_VERIFY_TOKEN_VERSION) return null
  if (!UUID_RE.test(conciergeId)) return null
  if (!DIGEST_RE.test(addressDigest) || !DIGEST_RE.test(sig)) return null

  const expected = await hmac(payload(conciergeId, addressDigest), secret)
  return safeEqual(expected, sig) ? { conciergeId, addressDigest } : null
}

/**
 * The full URL that goes in the mail.
 *
 * `endpointUrl` is either the pretty route on 2fronts.de (vercel.json rewrites
 * /absender-bestaetigen to the function) or the deployed function's own URL.
 * Returns null rather than throwing: mail building sits on a best-effort path
 * hanging off the coach's save, and must never take that save down.
 *
 * Plain http is refused except on loopback, mirroring buildConfirmUrl and
 * appUrl.ts. A verification token travelling over http is a verification anyone
 * on the path can spend.
 */
export async function buildReplyToVerifyUrl(
  endpointUrl: string,
  conciergeId: string,
  replyTo: string,
  secret: string,
): Promise<string | null> {
  const signed = await signReplyToVerifyToken(conciergeId, replyTo, secret)
  if (!signed) return null
  let parsed: URL
  try {
    parsed = new URL((endpointUrl ?? '').trim())
  } catch {
    return null
  }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) return null
  parsed.hash = ''
  parsed.searchParams.set(REPLY_TO_VERIFY_TOKEN_PARAM, signed)
  return parsed.toString()
}

// --------------------------------------------------------------------------
// The mail
// --------------------------------------------------------------------------

// The narrow view of a concierge row this module accepts. `calendar_url` is
// declared and never read: it is here so a caller can hand over the row it
// already has, and so a test can prove that doing so puts no booking link in a
// mail that is not allowed to carry one.
export interface ReplyToVerifyMailConcierge {
  business_name: string
  language?: string | null
  /** Present on the row, deliberately unused. See the module header. */
  calendar_url?: string | null
}

export interface ReplyToVerifyMailInput {
  concierge: ReplyToVerifyMailConcierge
  /** Built by buildReplyToVerifyUrl. Must already be signed. */
  verifyUrl: string
  /** Defaults to the concierge's own language. */
  locale?: ConsentLocale
}

export interface ReplyToVerifyMail {
  subject: string
  text: string
  html: string
}

export const REPLY_TO_VERIFY_SUBJECT: Record<ConsentLocale, string> = {
  de: 'Bitte bestätige deine Antwortadresse',
  en: 'Please confirm your reply-to address',
}

// The sentence that says plainly what silence costs. Exported so a test can
// assert it survives, and so nobody can soften it into "you might miss out".
// A coach who ignores this mail must not be left guessing why their queue never
// drains: the send path cancels every row while this address is unverified.
export const REPLY_TO_VERIFY_IGNORE_SENTENCE: Record<ConsentLocale, string> = {
  de:
    'Wenn du nichts tust, bleibt die Adresse unbestätigt und wir verschicken keine Nachfass-E-Mail.',
  en: 'If you do nothing, the address stays unconfirmed and we will not send any follow-up email.',
}

const LINK_LABEL: Record<ConsentLocale, string> = {
  de: 'Antwortadresse bestätigen',
  en: 'Confirm reply-to address',
}

const BUSINESS_NAME_MAX = 200

// Remove anything a mail client would turn into a link. The verification link is
// added by this module alone, and a coach who names their business
// "Jetzt buchen: https://..." must not be able to smuggle a second one in.
function stripLinks(value: string): string {
  return value.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
}

function cleanBusinessName(raw: string): string {
  const cleaned = stripLinks(raw).replace(/\s+/g, ' ').trim()
  return cleaned.length > BUSINESS_NAME_MAX ? cleaned.slice(0, BUSINESS_NAME_MAX).trim() : cleaned
}

interface Copy {
  intro: string
  ask: string
  linkLead: string
  ignore: string
  changed: string
  onlyThis: string
  notYou: string
}

const COPY: Record<ConsentLocale, (businessName: string) => Copy> = {
  de: (b) => ({
    intro: `du hast diese Adresse als Antwortadresse für die Nachfass-E-Mails von ${b} eingetragen.`,
    ask: 'Bitte bestätige, dass du dieses Postfach liest.',
    linkLead: 'Klicke dazu auf diesen Link:',
    ignore: REPLY_TO_VERIFY_IGNORE_SENTENCE.de,
    changed: 'Änderst du die Adresse später, gilt dieser Link nicht mehr und du bekommst eine neue E-Mail.',
    onlyThis: 'Mehr steht in dieser E-Mail nicht. Wir fragen nur nach, ob die Adresse stimmt.',
    notYou: 'Hast du das nicht eingerichtet, dann ignoriere diese E-Mail. Ohne Klick passiert nichts.',
  }),
  en: (b) => ({
    intro: `you entered this address as the reply-to address for the follow-up emails from ${b}.`,
    ask: 'Please confirm that you read this mailbox.',
    linkLead: 'To do that, click this link:',
    ignore: REPLY_TO_VERIFY_IGNORE_SENTENCE.en,
    changed: 'If you change the address later, this link stops working and you get a new email.',
    onlyThis: 'There is nothing else in this email. We are only asking whether the address is right.',
    notYou: 'If you did not set this up, ignore this email. Nothing happens without a click.',
  }),
}

const GREETING: Record<ConsentLocale, string> = { de: 'Hallo,', en: 'Hello,' }

/**
 * Build the verification mail.
 *
 * Returns null when there is nothing sendable: no business name left after
 * cleaning, or a verify URL that is not an https link we built. Callers must
 * treat null as "do not send", never as "send something simpler".
 */
export function buildReplyToVerifyMail(input: ReplyToVerifyMailInput): ReplyToVerifyMail | null {
  const locale: ConsentLocale = input.locale ?? (input.concierge.language === 'en' ? 'en' : 'de')
  const business = cleanBusinessName(input.concierge.business_name ?? '')
  if (!business) return null

  const url = input.verifyUrl?.trim() ?? ''
  if (!/^https:\/\/|^http:\/\/(?:localhost|127\.0\.0\.1)(?:[:/]|$)/i.test(url)) return null
  if (url.includes('"') || url.includes('<') || url.includes('>') || /\s/.test(url)) return null

  const c = COPY[locale](business)

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
    c.changed,
    '',
    c.onlyThis,
    '',
    c.notYou,
  ]
  const text = `${textParts.join('\n')}\n`

  // --- html ---------------------------------------------------------------
  //
  // The URL appears ONCE, in the href. A visible copy of it next to the link
  // would be a second occurrence, and the tests count occurrences to keep the
  // "one link" claim mechanically true.
  //
  // Der Rundgang inside a mail client, identical to consentMail.ts: linen
  // ground, hard edges, no radius, the lamp on the one action. No shadow,
  // because the lamp glow is an rgba box-shadow Outlook drops.
  const html = `<!doctype html>
<html lang="${escapeAttr(locale)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(REPLY_TO_VERIFY_SUBJECT[locale])}</title>
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
      <p style="margin:0 0 1rem;color:#56503f;">${escapeHtml(c.changed)}</p>
      <p style="margin:0 0 1rem;color:#56503f;">${escapeHtml(c.onlyThis)}</p>
      <p style="margin:0;color:#56503f;font-size:0.85rem;">${escapeHtml(c.notYou)}</p>
    </div>
  </div>
</body>
</html>
`

  return { subject: REPLY_TO_VERIFY_SUBJECT[locale], text, html }
}
