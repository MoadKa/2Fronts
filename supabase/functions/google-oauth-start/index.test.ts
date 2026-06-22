import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { GOOGLE_OAUTH_SCOPES, handleOAuthStart, type OAuthStartDeps } from './index.ts'
import { OAUTH_STATE_COOKIE, verifyState } from '../_shared/oauthState.ts'

const STATE_SECRET = 'test-oauth-state-secret'

function fakeEnv(values: Record<string, string>): OAuthStartDeps {
  return { getEnv: (key) => values[key] }
}

const CONFIGURED = fakeEnv({
  GOOGLE_OAUTH_CLIENT_ID: 'fake-client-id.apps.googleusercontent.com',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://app.example.com/functions/v1/google-oauth-callback',
  OAUTH_STATE_SECRET: STATE_SECRET,
})

// Pull the nonce out of the Set-Cookie header.
function cookieNonce(res: Response): string | null {
  const sc = res.headers.get('Set-Cookie') ?? ''
  const m = sc.match(new RegExp(`${OAUTH_STATE_COOKIE}=([^;]+)`))
  return m ? m[1] : null
}

Deno.test('302s to Google consent with a SIGNED state that verifies against the cookie nonce', async () => {
  const req = new Request('http://localhost/google-oauth-start?state=prov-123')
  const res = await handleOAuthStart(req, CONFIGURED)

  assertEquals(res.status, 302)
  const location = res.headers.get('Location') ?? ''
  assertStringIncludes(location, 'https://accounts.google.com/o/oauth2/v2/auth')

  const parsed = new URL(location)
  assertEquals(parsed.searchParams.get('client_id'), 'fake-client-id.apps.googleusercontent.com')
  assertEquals(parsed.searchParams.get('access_type'), 'offline')
  assertEquals(parsed.searchParams.get('prompt'), 'consent')
  assertEquals(
    parsed.searchParams.get('redirect_uri'),
    'https://app.example.com/functions/v1/google-oauth-callback',
  )
  const scope = parsed.searchParams.get('scope') ?? ''
  for (const expected of GOOGLE_OAUTH_SCOPES) assertStringIncludes(scope, expected)

  // The state is no longer the raw provision id — it's signed, and verifies back
  // to the provision id only with the matching cookie nonce.
  const state = parsed.searchParams.get('state') ?? ''
  assertEquals(state.startsWith('prov-123.'), true)
  const nonce = cookieNonce(res)
  assertEquals(nonce !== null, true)
  assertEquals(await verifyState(state, nonce, STATE_SECRET), 'prov-123')
  // A flow with no/foreign cookie nonce is rejected (CSRF).
  assertEquals(await verifyState(state, 'foreign', STATE_SECRET), null)

  // The cookie is locked down.
  const sc = res.headers.get('Set-Cookie') ?? ''
  assertStringIncludes(sc, 'HttpOnly')
  assertStringIncludes(sc, 'SameSite=Lax')
})

Deno.test('accepts the carried id from provision_id when state is absent', async () => {
  const req = new Request('http://localhost/google-oauth-start?provision_id=prov-456')
  const res = await handleOAuthStart(req, CONFIGURED)
  const state = new URL(res.headers.get('Location') ?? '').searchParams.get('state') ?? ''
  assertEquals(state.startsWith('prov-456.'), true)
  assertEquals(await verifyState(state, cookieNonce(res), STATE_SECRET), 'prov-456')
})

Deno.test('returns 500 when Google OAuth env is not configured', async () => {
  const res = await handleOAuthStart(new Request('http://localhost/google-oauth-start?state=prov-123'), fakeEnv({}))
  assertEquals(res.status, 500)
})

Deno.test('returns 400 when no provision id is supplied', async () => {
  const res = await handleOAuthStart(new Request('http://localhost/google-oauth-start'), CONFIGURED)
  assertEquals(res.status, 400)
})
