// CSRF protection for the Google OAuth connect flow.
//
// The connect used to pass the provision id as a raw `state`. That let an
// attacker start a connect for THEIR OWN provision and trick a logged-in victim
// into completing it — the victim's Google token would then be stored against
// the attacker's provision. Signing alone doesn't stop that (the attacker's
// state is legitimately signed), so we bind the flow to the BROWSER that started
// it: oauth-start sets an HttpOnly nonce cookie and embeds the same nonce in the
// signed state; the callback requires the cookie nonce to equal the state nonce.
// A flow an attacker started (their cookie) cannot be completed in a victim's
// browser (different/absent cookie) -> rejected.
//
// state format:  <provisionId>.<exp>.<nonce>.<sig>
//   sig = base64url(HMAC-SHA256("<provisionId>.<exp>.<nonce>", OAUTH_STATE_SECRET))
// provisionId is a UUID (no dots), exp is epoch seconds, nonce/sig are base64url
// (no dots), so a plain split on "." is unambiguous.

export const OAUTH_STATE_COOKIE = '2f_oauth_state'
const STATE_TTL_SECONDS = 600 // 10 minutes

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

function randomNonce(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)))
}

export interface SignedState {
  state: string
  nonce: string
}

export async function signState(provisionId: string, secret: string, nowMs = Date.now()): Promise<SignedState> {
  const nonce = randomNonce()
  const exp = Math.floor(nowMs / 1000) + STATE_TTL_SECONDS
  const sig = await hmac(`${provisionId}.${exp}.${nonce}`, secret)
  return { state: `${provisionId}.${exp}.${nonce}.${sig}`, nonce }
}

// Constant-time-ish string compare (avoids leaking via early-exit timing).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Returns the provisionId when the state is well-formed, unexpired, correctly
// signed, AND the nonce matches the cookie. Otherwise null (fail closed).
export async function verifyState(
  state: string,
  cookieNonce: string | null,
  secret: string,
  nowMs = Date.now(),
): Promise<string | null> {
  if (!state || !cookieNonce || !secret) return null
  const parts = state.split('.')
  if (parts.length !== 4) return null
  const [provisionId, expStr, nonce, sig] = parts
  if (!provisionId || !nonce || !safeEqual(nonce, cookieNonce)) return null
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < Math.floor(nowMs / 1000)) return null
  const expected = await hmac(`${provisionId}.${exp}.${nonce}`, secret)
  return safeEqual(expected, sig) ? provisionId : null
}

// Pull one cookie value out of a Cookie header.
export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

export function stateCookie(nonce: string): string {
  return `${OAUTH_STATE_COOKIE}=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${STATE_TTL_SECONDS}`
}

export function clearStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}
