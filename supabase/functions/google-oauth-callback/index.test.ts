import { assertEquals, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { decryptToken, encryptToken } from '../_shared/tokenCrypto.ts'
import { handleOAuthCallback, type OAuthCallbackDeps } from './index.ts'

const TEST_KEY_B64 = btoa('0123456789abcdef0123456789abcdef')

const ENV: Record<string, string> = {
  GOOGLE_OAUTH_CLIENT_ID: 'fake-client-id.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'fake-client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://app.example.com/functions/v1/google-oauth-callback',
  PUBLIC_APP_URL: 'https://app.example.com',
  CONNECTOR_TOKEN_KEY: TEST_KEY_B64,
}

const PLAINTEXT_REFRESH = '1//fake-refresh-token'
const GRANTED_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

interface CapturedUpsert {
  table?: string
  row?: Record<string, unknown>
  options?: unknown
}

function fakeAdminClient(captured: CapturedUpsert, opts: { error?: Error } = {}) {
  return () => ({
    from(table: string) {
      captured.table = table
      return {
        upsert(row: Record<string, unknown>, options: unknown) {
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
  adminOpts: { error?: Error } = {},
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

  const req = new Request('http://localhost/google-oauth-callback?code=auth-code&state=cust-1')
  const res = await handleOAuthCallback(req, makeDeps(captured, fn))

  // Redirects back into the app on success.
  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'https://app.example.com/connections/result?status=success')

  // Hit both Google endpoints.
  assertEquals(calls.some((c) => c.includes('oauth2.googleapis.com/token')), true)
  assertEquals(calls.some((c) => c.includes('userinfo')), true)

  // Right table + columns.
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

Deno.test('redirects to error (no upsert) when token exchange fails', async () => {
  const captured: CapturedUpsert = {}
  const { fn } = fakeFetch({ error: 'invalid_grant' }, {}, { tokenOk: false })

  const req = new Request('http://localhost/google-oauth-callback?code=bad&state=cust-1')
  const res = await handleOAuthCallback(req, makeDeps(captured, fn))

  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'status=error')
  assertEquals(captured.table, undefined)
})

Deno.test('redirects to error when Google returns no refresh token', async () => {
  const captured: CapturedUpsert = {}
  const { fn } = fakeFetch({ access_token: 'at-123', scope: GRANTED_SCOPE }, { email: 'x@y.com' })

  const req = new Request('http://localhost/google-oauth-callback?code=auth&state=cust-1')
  const res = await handleOAuthCallback(req, makeDeps(captured, fn))

  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'status=error')
  assertEquals(captured.table, undefined)
})

Deno.test('redirects to error when code or state is missing', async () => {
  const captured: CapturedUpsert = {}
  const { fn } = fakeFetch({}, {})

  const req = new Request('http://localhost/google-oauth-callback?state=cust-1')
  const res = await handleOAuthCallback(req, makeDeps(captured, fn))

  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'status=error')
  assertEquals(captured.table, undefined)
})

Deno.test('redirects to error when the user denies consent', async () => {
  const captured: CapturedUpsert = {}
  const { fn } = fakeFetch({}, {})

  const req = new Request('http://localhost/google-oauth-callback?error=access_denied&state=cust-1')
  const res = await handleOAuthCallback(req, makeDeps(captured, fn))

  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'status=error')
  assertEquals(captured.table, undefined)
})
