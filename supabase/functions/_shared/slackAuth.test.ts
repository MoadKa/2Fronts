import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { getSlackTokenForCustomer } from './slackAuth.ts'

// A fake admin client serving the connector_connections lookup
// (from().select().eq().eq().maybeSingle()).
function fakeAdminClient(row: { encrypted_refresh_token: string | null; status: string } | null) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return { maybeSingle: () => Promise.resolve({ data: row, error: null }) }
                },
              }
            },
          }
        },
      }
    },
  } as never
}

Deno.test('getSlackTokenForCustomer decrypts and returns the stored bot token', async () => {
  const token = await getSlackTokenForCustomer(
    fakeAdminClient({ encrypted_refresh_token: 'ciphertext', status: 'active' }),
    'cust-1',
    { decryptToken: (c) => Promise.resolve(`decrypted:${c}`) },
  )
  assertEquals(token, 'decrypted:ciphertext')
})

Deno.test('getSlackTokenForCustomer throws when there is no connection', async () => {
  await assertRejects(
    () => getSlackTokenForCustomer(fakeAdminClient(null), 'cust-1', { decryptToken: () => Promise.resolve('x') }),
    Error,
    'no_connection',
  )
})

Deno.test('getSlackTokenForCustomer throws when the stored token is empty', async () => {
  await assertRejects(
    () =>
      getSlackTokenForCustomer(
        fakeAdminClient({ encrypted_refresh_token: null, status: 'active' }),
        'cust-1',
        { decryptToken: () => Promise.resolve('x') },
      ),
    Error,
    'no_connection',
  )
})
