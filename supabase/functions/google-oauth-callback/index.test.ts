import { assertEquals, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { decryptToken, encryptToken } from '../_shared/tokenCrypto.ts'
import { handleOAuthCallback, type OAuthCallbackDeps } from './index.ts'
import { OAUTH_STATE_COOKIE, signState } from '../_shared/oauthState.ts'

const TEST_KEY_B64 = btoa('0123456789abcdef0123456789abcdef')
const STATE_SECRET = 'test-oauth-state-secret'

const ENV: Record<string, string> = {
  GOOGLE_OAUTH_CLIENT_ID: 'fake-client-id.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'fake-client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://app.example.com/functions/v1/google-oauth-callback',
  PUBLIC_APP_URL: 'https://app.example.com',
  CONNECTOR_TOKEN_KEY: TEST_KEY_B64,
  OAUTH_STATE_SECRET: STATE_SECRET,
}

// Build a callback request whose state is properly signed and whose cookie nonce
// matches — i.e. the same browser that started the flow. `cookie: null` simulates
// a foreign/CSRF browser; `cookie: '<val>'` overrides it.
async function signedCallbackReq(
  provisionId: string,
  opts: { code?: string | null; cookie?: string | null } = {},
): Promise<Request> {
  const { state, nonce } = await signState(provisionId, STATE_SECRET)
  const code = opts.code === undefined ? 'auth-code' : opts.code
  const qs = new URLSearchParams()
  if (code) qs.set('code', code)
  qs.set('state', state)
  const headers: Record<string, string> = {}
  const cookie = opts.cookie === undefined ? `${OAUTH_STATE_COOKIE}=${nonce}` : opts.cookie
  if (cookie) headers['Cookie'] = cookie
  return new Request(`http://localhost/google-oauth-callback?${qs.toString()}`, { headers })
}

const PLAINTEXT_REFRESH = '1//fake-refresh-token'
const GRANTED_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

interface CapturedUpsert {
  table?: string
  row?: Record<string, unknown>
  options?: unknown
}

// The fake admin client serves two calls: the provision -> customer lookup
// (from('automation_provisions').select().eq().maybeSingle()) and the
// connection upsert (from('connector_connections').upsert()).
function fakeAdminClient(
  captured: CapturedUpsert,
  opts: { error?: Error; customerId?: string; provisionMissing?: boolean } = {},
) {
  return () => ({
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                maybeSingle() {
                  if (opts.provisionMissing) {
                    return Promise.resolve({ data: null, error: null })
                  }
                  return Promise.resolve({
                    data: {
                      request_id: 'req-1',
                      automation_requests: { customer_id: opts.customerId ?? 'cust-1' },
                    },
                    error: null,
                  })
                },
              }
            },
          }
        },
        upsert(row: Record<string, unknown>, options: unknown) {
          captured.table = table
          captured.row = row
          captured.options = options
          return Promise.resolve({ data: null, error: opts.error ?? null })
        },
      }
    },
  })
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response)
}

function fakeFetch(token: unknown, userinfo: unknown, opts: { tokenOk?: boolean } = {}) {
  const calls: string[] = []
  const fn = ((input: string | URL | Request) => {
    const urlStr = typeof input === 'string' ? input : input.toString()
    calls.push(urlStr)
    if (urlStr.includes('oauth2.googleapis.com/token')) {
      return jsonResponse(token, opts.tokenOk ?? true)
    }
    if (urlStr.includes('userinfo')) {
      return jsonResponse(userinfo, true)
    }
    throw new Error(`unexpected fetch: ${urlStr}`)
  }) as unknown as typeof fetch
  return { fn, calls }
}

function makeDeps(
  captured: CapturedUpsert,
  fetchImpl: typeof fetch,
  envOverrides: Record<string, string> = {},
  adminOpts: { error?: Error; customerId?: string; provisionMissing?: boolean } = {},
): OAuthCallbackDeps {
  const env = { ...ENV, ...envOverrides }
  return {
    getEnv: (key) => env[key],
    fetch: fetchImpl,
    createAdminClient: fakeAdminClient(captured, adminOpts) as never,
    // Use the real encryptToken so we prove the stored value is genuinely
    // encrypted and decrypts back to the plaintext refresh token.
    encryptToken,
  }
}

Deno.test('exchanges code, encrypts refresh token, and upserts the connection', async () => {
  Deno.env.set('CONNECTOR_TOKEN_KEY', TEST_KEY_B64)
  const captured: CapturedUpsert = {}
  const { fn, calls } = fakeFetch(
    { access_token: 'at-123', refresh_token: PLAINTEXT_REFRESH, scope: GRANTED_SCOPE },
    { email: 'customer@gmail.com' },
  )

  // state carries the PROVISION id; the customer is derived from it server-side.
  const req = await signedCallbackReq('prov-1')
  const res = await handleOAuthCallback(req, makeDeps(captured, fn))

  // On success, redirects to THAT provision's mapping confirmation screen.
  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'https://app.example.com/connect/prov-1/confirm')

  // Hit both Google endpoints.
  assertEquals(calls.some((c) => c.includes('oauth2.googleapis.com/token')), true)
  assertEquals(calls.some((c) => c.includes('userinfo')), true)

  // Right table + columns. customer_id is the one resolved from the provision,
  // never the raw state value.
  assertEquals(captured.table, 'connector_connections')
  const row = captured.row!
  assertEquals(row.customer_id, 'cust-1')
  assertEquals(row.connector_type, 'google_sheets')
  assertEquals(row.scope, GRANTED_SCOPE)
  assertEquals(row.external_account_email, 'customer@gmail.com')
  assertEquals(row.status, 'active')
  assertEquals(captured.options, { onConflict: 'customer_id,connector_type' })

  // The stored token must be ENCRYPTED (not the plaintext) and round-trip back.
  const stored = row.encrypted_refresh_token as string
  assertNotEquals(stored, PLAINTEXT_REFRESH)
  assertEquals(stored.includes(PLAINTEXT_REFRESH), false)
  assertEquals(await decryptToken(stored), PLAINTEXT_REFRESH)
})

Deno.test('CSRF: rejects a valid signed state completed in a browser without the matching cookie', async () => {
  Deno.env.set('CONNECTOR_TOKEN_KEY', TEST_KEY_B64)
  const captured: CapturedUpsert = {}
  const { fn, calls } = fakeFetch(
    { access_token: 'at-123', refresh_token: PLAINTEXT_REFRESH, scope: GRANTED_SCOPE },
    { email: 'customer@gmail.com' },
  )

  // The state is legitimately signed (attacker started a flow for their own
  // provision), but the victim's browser has no matching nonce cookie.
  const req = await signedCallbackReq('prov-1', { cookie: null })
  const res = await handleOAuthCallback(req, makeDeps(captured, fn))

  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'status=error')
  // Fails closed BEFORE exchanging the code or writing anything.
  assertEquals(calls.length, 0)
  assertEquals(captured.table, undefined)
})

Deno.test('redirects to error (no upsert) when the provision in state is unknown', async () => {
  Deno.env.set('CONNECTOR_TOKEN_KEY', TEST_KEY_B64)
  const captured: CapturedUpsert = {}
  const { fn } = fakeFetch(
    { access_token: 'at-123', refresh_token: PLAINTEXT_REFRESH, scope: GRANTED_SCOPE },
    { email: 'customer@gmail.com' },
  )

  // A forged/stale state that doesn't resolve to any provision must fail closed:
  // no connection is written against a guessed customer id.
  const req = await signedCallbackReq('prov-nope')
  const res = await handleOAuthCallback(req, makeDeps(captured, fn, {}, { provisionMissing: true }))

  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'status=error')
  assertEquals(captured.table, undefined)
})

Deno.test('redirects to error (no upsert) when token exchange fails', async () => {
  const captured: CapturedUpsert = {}
  const { fn } = fakeFetch({ error: 'invalid_grant' }, {}, { tokenOk: false })

  const req = await signedCallbackReq('prov-1', { code: 'bad' })
  const res = await handleOAuthCallback(req, makeDeps(captured, fn))

  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'status=error')
  assertEquals(captured.table, undefined)
})

Deno.test('redirects to error when Google returns no refresh token', async () => {
  const captured: CapturedUpsert = {}
  const { fn } = fakeFetch({ access_token: 'at-123', scope: GRANTED_SCOPE }, { email: 'x@y.com' })

  const req = await signedCallbackReq('prov-1')
  const res = await handleOAuthCallback(req, makeDeps(captured, fn))

  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'status=error')
  assertEquals(captured.table, undefined)
})

Deno.test('redirects to error when code or state is missing', async () => {
  const captured: CapturedUpsert = {}
  const { fn } = fakeFetch({}, {})

  const req = new Request('http://localhost/google-oauth-callback?state=prov-1')
  const res = await handleOAuthCallback(req, makeDeps(captured, fn))

  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'status=error')
  assertEquals(captured.table, undefined)
})

Deno.test('redirects to error when the user denies consent', async () => {
  const captured: CapturedUpsert = {}
  const { fn } = fakeFetch({}, {})

  const req = new Request('http://localhost/google-oauth-callback?error=access_denied&state=prov-1')
  const res = await handleOAuthCallback(req, makeDeps(captured, fn))

  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'status=error')
  assertEquals(captured.table, undefined)
})
