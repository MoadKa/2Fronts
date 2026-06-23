import { assertEquals, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { decryptToken, encryptToken } from '../_shared/tokenCrypto.ts'
import { handleSlackOAuthCallback, type SlackOAuthCallbackDeps } from './index.ts'
import { OAUTH_STATE_COOKIE, signState } from '../_shared/oauthState.ts'

const TEST_KEY_B64 = btoa('0123456789abcdef0123456789abcdef')
const STATE_SECRET = 'test-oauth-state-secret'

const ENV: Record<string, string> = {
  SLACK_CLIENT_ID: 'fake-client-id',
  SLACK_CLIENT_SECRET: 'fake-client-secret',
  SLACK_OAUTH_REDIRECT_URI: 'https://app.example.com/functions/v1/slack-oauth-callback',
  PUBLIC_APP_URL: 'https://app.example.com',
  CONNECTOR_TOKEN_KEY: TEST_KEY_B64,
  OAUTH_STATE_SECRET: STATE_SECRET,
}

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
  return new Request(`http://localhost/slack-oauth-callback?${qs.toString()}`, { headers })
}

const BOT_TOKEN = 'xoxb-fake-bot-token'

interface CapturedUpsert {
  table?: string
  row?: Record<string, unknown>
  options?: unknown
}

function fakeAdminClient(
  captured: CapturedUpsert,
  opts: { error?: Error; customerId?: string; provisionMissing?: boolean } = {},
) {
  return () => ({
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle() {
                  if (opts.provisionMissing) return Promise.resolve({ data: null, error: null })
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
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as unknown as Response)
}

function deps(overrides: Partial<SlackOAuthCallbackDeps>, captured: CapturedUpsert): SlackOAuthCallbackDeps {
  return {
    getEnv: (k) => ENV[k],
    fetch: (() => jsonResponse({ ok: true, access_token: BOT_TOKEN, scope: 'chat:write,channels:read', team: { name: 'Acme' } })) as unknown as typeof fetch,
    createAdminClient: fakeAdminClient(captured) as never,
    encryptToken,
    ...overrides,
  }
}

Deno.test('slack callback exchanges code, encrypts the bot token, and upserts the connection', async () => {
  Deno.env.set('CONNECTOR_TOKEN_KEY', TEST_KEY_B64)
  const captured: CapturedUpsert = {}
  const res = await handleSlackOAuthCallback(await signedCallbackReq('prov-1'), deps({}, captured))

  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', '/connect/prov-1/confirm')
  assertEquals(captured.table, 'connector_connections')
  assertEquals(captured.row?.connector_type, 'slack_notifications')
  assertEquals(captured.row?.customer_id, 'cust-1')
  // The stored token is ciphertext, not the plaintext bot token...
  const stored = captured.row?.encrypted_refresh_token as string
  assertNotEquals(stored, BOT_TOKEN)
  // ...and it round-trips back to the original.
  assertEquals(await decryptToken(stored), BOT_TOKEN)
})

Deno.test('slack callback rejects a foreign browser (no matching nonce cookie)', async () => {
  const captured: CapturedUpsert = {}
  const res = await handleSlackOAuthCallback(
    await signedCallbackReq('prov-1', { cookie: null }),
    deps({}, captured),
  )
  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'status=error')
  // Nothing persisted on a rejected (CSRF) flow.
  assertEquals(captured.table, undefined)
})

Deno.test('slack callback fails when the token exchange returns ok:false', async () => {
  const captured: CapturedUpsert = {}
  const res = await handleSlackOAuthCallback(
    await signedCallbackReq('prov-1'),
    deps({ fetch: (() => jsonResponse({ ok: false, error: 'bad_code' })) as unknown as typeof fetch }, captured),
  )
  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'status=error')
  assertEquals(captured.table, undefined)
})

Deno.test('slack callback fails closed when the provision is unknown', async () => {
  Deno.env.set('CONNECTOR_TOKEN_KEY', TEST_KEY_B64)
  const captured: CapturedUpsert = {}
  const res = await handleSlackOAuthCallback(
    await signedCallbackReq('prov-1'),
    deps({ createAdminClient: fakeAdminClient(captured, { provisionMissing: true }) as never }, captured),
  )
  assertEquals(res.status, 302)
  assertStringIncludes(res.headers.get('Location') ?? '', 'status=error')
})
