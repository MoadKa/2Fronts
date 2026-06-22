import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1'
import { getAccessTokenForCustomer, type GoogleAuthDeps } from './googleAuth.ts'

const ENV: Record<string, string> = {
  GOOGLE_OAUTH_CLIENT_ID: 'fake-client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'fake-client-secret',
}

interface CapturedUpdate {
  payload?: Record<string, unknown>
}

// Fake admin client serving the connection lookup
// (select().eq().eq().maybeSingle()) and the revoke update
// (update().eq().eq()).
function fakeAdminClient(
  opts: { connection?: ConnectionData | null; captured?: CapturedUpdate } = {},
) {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_c: string, _v: string) {
              return {
                eq(_c2: string, _v2: string) {
                  return {
                    maybeSingle() {
                      return Promise.resolve({
                        data: opts.connection ?? null,
                        error: null,
                      })
                    },
                  }
                },
              }
            },
          }
        },
        update(payload: Record<string, unknown>) {
          if (opts.captured) opts.captured.payload = payload
          return {
            eq(_c: string, _v: string) {
              return { eq(_c2: string, _v2: string) { return Promise.resolve({ error: null }) } }
            },
          }
        },
      }
    },
  } as never
}

interface ConnectionData {
  encrypted_refresh_token: string | null
  status: string
}

function deps(fetchImpl: typeof fetch): GoogleAuthDeps {
  return {
    getEnv: (key) => ENV[key],
    fetch: fetchImpl,
    // A deterministic stand-in for the real AES-GCM decrypt.
    decryptToken: (ciphertext) => Promise.resolve(`refresh-from-${ciphertext}`),
  }
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as unknown as Response)
}

Deno.test('refreshes a live access token and sends the decrypted refresh token to Google', async () => {
  let sentBody = ''
  const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => {
    sentBody = init?.body?.toString() ?? ''
    return jsonResponse({ access_token: 'live-access-token' })
  }) as unknown as typeof fetch

  const admin = fakeAdminClient({ connection: { encrypted_refresh_token: 'cipher', status: 'active' } })
  const token = await getAccessTokenForCustomer(admin, 'cust-1', deps(fetchImpl))

  assertEquals(token, 'live-access-token')
  assertStringIncludes(sentBody, 'grant_type=refresh_token')
  // The DECRYPTED refresh token is what we send, not the stored ciphertext.
  assertStringIncludes(sentBody, 'refresh_token=refresh-from-cipher')
})

Deno.test('throws no_connection when the customer has no google_sheets connection', async () => {
  const admin = fakeAdminClient({ connection: null })
  await assertRejects(
    () => getAccessTokenForCustomer(admin, 'cust-1', deps((() => jsonResponse({})) as unknown as typeof fetch)),
    Error,
    'no_connection',
  )
})

Deno.test('marks the connection revoked and throws on invalid_grant', async () => {
  const captured: CapturedUpdate = {}
  const fetchImpl = (() => jsonResponse({ error: 'invalid_grant' }, false, 400)) as unknown as typeof fetch
  const admin = fakeAdminClient({
    connection: { encrypted_refresh_token: 'cipher', status: 'active' },
    captured,
  })

  await assertRejects(
    () => getAccessTokenForCustomer(admin, 'cust-1', deps(fetchImpl)),
    Error,
    'token_refresh_failed',
  )
  // The dead grant flips the connection to revoked so the UI can prompt reconnect.
  assertEquals(captured.payload?.status, 'revoked')
})
