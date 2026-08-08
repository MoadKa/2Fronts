// The one-click withdrawal link that sits at the bottom of every follow-up mail.
//
// §7 Abs. 2 UWG lets us send that mail only because the recipient confirmed a
// consent, and the notice they read (consent.ts) promises them, in writing,
// "Du kannst jederzeit widerrufen, mit einem Klick am Ende der E-Mail." A mail
// that carries that sentence and then a link that does not work is not a
// cosmetic bug: it is the promise the consent was given on, broken. The whole
// evidence ledger under consent.ts would then document a consent obtained on a
// term we did not honour.
//
// TOKEN FORMAT
//
//     t = v1.<conciergeId>.<conversationId>.<sig>
//     sig = b64url(HMAC-SHA256("v1.<conciergeId>.<conversationId>", secret))
//
// Both ids are UUIDs and carry no dots, and the version tag and the signature
// are dot-free by construction, so a plain split on '.' is unambiguous.
//
// THE ADDRESS IS NOT IN THE TOKEN, DELIBERATELY. The endpoint resolves it from
// the consent row for (concierge_id, conversation_id). An unsubscribe URL is
// the one URL in the mail that is guaranteed to be copied into support tickets,
// pasted into chats, prefetched by scanners, and written to every proxy access
// log between the recipient and us. Putting the recipient's own email address
// into that string would leak it to every one of those places, forever, in
// order to save one indexed read.
//
// NO EXPIRY, DELIBERATELY. Every other signed thing in this codebase carries
// one (oauthState 10 minutes, the confirm token a DB column). This one must
// not. An opt-out has to work the day someone finally gets round to it, and
// that is exactly the mail from eleven months ago that they just dug out of a
// folder. A link that answers "this expired" to a person trying to leave is a
// §7 UWG failure with a stack trace. The withdrawal is idempotent and the worst
// an old token can do is suppress mail that was already suppressed, so there is
// nothing an expiry would protect.
//
// ROTATION MUST NOT ORPHAN THE INBOXES. verifyUnsubscribeToken accepts a
// PREVIOUS secret alongside the current one, and the endpoint wires it to
// FOLLOWUP_UNSUB_SECRET_PREVIOUS. Rotating a signing secret with no fallback
// would, at the instant of the rotation, silently invalidate every unsubscribe
// link already sitting in people's inboxes — the exact failure this module
// exists to prevent, reached through ops instead of through code. Signing
// always uses the current secret, so the old one drains out on its own and can
// be dropped once the last mail signed under it is older than anyone will act
// on.
//
// The b64url / hmac / safeEqual primitives are COPIED from oauthState.ts rather
// than imported, exactly as consentMail.ts copied them and for the same reason:
// that module is the OAuth CSRF story and owns a cookie name and a TTL that
// have nothing to do with a withdrawal link. Two twelve-line primitives are a
// cheaper dependency than a shared module three flows would have to agree
// about.

export const UNSUBSCRIBE_TOKEN_PARAM = 't'
export const UNSUBSCRIBE_UNDO_PARAM = 'undo'
export const UNSUBSCRIBE_UNDO_VALUE = '1'

// The version tag exists so a future format change can be rolled out without
// guessing: an unknown prefix is refused before a hash is spent, and refusing
// costs nothing because we would still be signing v1 links at that point.
export const UNSUBSCRIBE_TOKEN_VERSION = 'v1'

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
// b64url of a SHA-256 digest, unpadded, is exactly 43 characters.
const SIGNATURE_RE = /^[A-Za-z0-9_-]{43}$/

// v1(2) + 2 dots + 36 + 1 + 36 + 43 = 120. The cap is what stops an attacker
// making us hash a megabyte per request; it is not a format check.
export const UNSUBSCRIBE_PARAM_MAX_LEN = 200

// The only host family an opt-out link may point at. A recipient who is trying
// to leave and is shown a *.supabase.co URL reads it as a phish, and a mail
// provider's abuse desk reads it the same way. The link has to look like it
// belongs to the sender they know.
const ALLOWED_HOST_SUFFIX = '2fronts.de'

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

/** What a valid token proves: which setter, and which conversation. */
export interface UnsubscribeClaim {
  conciergeId: string
  conversationId: string
}

function payload(conciergeId: string, conversationId: string): string {
  return `${UNSUBSCRIBE_TOKEN_VERSION}.${conciergeId}.${conversationId}`
}

/**
 * The value of the `t` query parameter.
 *
 * Returns null when there is no secret or an id is not a UUID. A caller that
 * gets null MUST NOT SEND THE MAIL: a follow-up whose withdrawal link cannot be
 * built is a follow-up with no way out of it, and the mail's own footer would
 * be a false statement.
 */
export async function signUnsubscribeToken(
  conciergeId: string,
  conversationId: string,
  secret: string,
): Promise<string | null> {
  if (!secret) return null
  if (!UUID_RE.test(conciergeId) || !UUID_RE.test(conversationId)) return null
  const message = payload(conciergeId, conversationId)
  return `${message}.${await hmac(message, secret)}`
}

/**
 * The inverse. Returns the claim when the token is well-formed and signed by
 * EITHER the current or the previous secret, otherwise null.
 *
 * Fails closed on everything: no secret, oversized input, unknown version,
 * non-UUID ids, wrong signature shape, bad signature. Callers rely on null
 * meaning "touch no database", so nothing in here may reach for one.
 */
export async function verifyUnsubscribeToken(
  raw: string | null | undefined,
  secret: string,
  previousSecret?: string | null,
): Promise<UnsubscribeClaim | null> {
  if (!raw) return null
  if (raw.length > UNSUBSCRIBE_PARAM_MAX_LEN) return null

  const secrets = [secret, previousSecret ?? ''].filter((s) => typeof s === 'string' && s.length > 0)
  if (secrets.length === 0) return null

  const parts = raw.split('.')
  if (parts.length !== 4) return null
  const [version, conciergeId, conversationId, sig] = parts
  if (version !== UNSUBSCRIBE_TOKEN_VERSION) return null
  if (!UUID_RE.test(conciergeId) || !UUID_RE.test(conversationId)) return null
  if (!SIGNATURE_RE.test(sig)) return null

  const message = payload(conciergeId, conversationId)
  // Both secrets are always tried in full, and the result is accumulated rather
  // than returned early, so "signed by the current secret" and "signed by the
  // previous one" cost the same two hashes and the same walk.
  let ok = false
  for (const s of secrets) {
    if (safeEqual(await hmac(message, s), sig)) ok = true
  }
  return ok ? { conciergeId, conversationId } : null
}

/**
 * The full URL that goes in the mail footer and in the List-Unsubscribe header.
 *
 * `baseUrl` is FOLLOWUP_PUBLIC_BASE_URL, e.g. `https://2fronts.de/abmelden`,
 * and it MUST be on 2fronts.de. See ALLOWED_HOST_SUFFIX. Returns null rather
 * than throwing, so a misconfigured project loses the mail rather than the
 * request that was building it.
 */
export async function buildUnsubscribeUrl(
  baseUrl: string | undefined,
  conciergeId: string,
  conversationId: string,
  secret: string,
): Promise<string | null> {
  const signed = await signUnsubscribeToken(conciergeId, conversationId, secret)
  if (!signed) return null

  let parsed: URL
  try {
    parsed = new URL((baseUrl ?? '').trim())
  } catch {
    return null
  }
  // https only, no loopback exception. Unlike the confirm link there is no
  // local-development story that needs one: a withdrawal link is only ever
  // built on the send path, and the send path does not run against localhost.
  if (parsed.protocol !== 'https:') return null

  const host = parsed.hostname.toLowerCase()
  if (host !== ALLOWED_HOST_SUFFIX && !host.endsWith(`.${ALLOWED_HOST_SUFFIX}`)) return null

  parsed.hash = ''
  parsed.searchParams.set(UNSUBSCRIBE_TOKEN_PARAM, signed)
  return parsed.toString()
}

/**
 * The RFC 8058 header pair.
 *
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` is what tells Gmail and
 * Outlook that they may render their own "unsubscribe" affordance and POST to
 * the URL without the recipient ever seeing our page. Sending the first header
 * without the second gets the link opened in a browser instead, which still
 * works but loses the one-click affordance; sending the second without the
 * first is meaningless. They ship together or not at all, which is why this
 * returns both or nothing.
 */
export function buildListUnsubscribeHeaders(url: string | null): Record<string, string> {
  if (!url) return {}
  // Defensive: a URL with a delimiter in it would break the header it lands in.
  if (/[<>,\s]/.test(url)) return {}
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
