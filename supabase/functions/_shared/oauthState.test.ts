import { assertEquals } from 'jsr:@std/assert@1'
import { clearStateCookie, OAUTH_STATE_COOKIE, readCookie, signState, stateCookie, verifyState } from './oauthState.ts'

const SECRET = 'test-oauth-state-secret'

Deno.test('a freshly signed state round-trips back to the provision id (with matching nonce)', async () => {
  const { state, nonce } = await signState('prov-1', SECRET)
  assertEquals(await verifyState(state, nonce, SECRET), 'prov-1')
})

Deno.test('rejects when the cookie nonce does not match (the CSRF case)', async () => {
  const { state } = await signState('prov-1', SECRET)
  // Attacker started the flow (their nonce in state); victim's browser has a
  // different/absent cookie -> must reject.
  assertEquals(await verifyState(state, 'a-different-nonce', SECRET), null)
  assertEquals(await verifyState(state, null, SECRET), null)
})

Deno.test('rejects a tampered provision id (signature no longer valid)', async () => {
  const { state, nonce } = await signState('prov-1', SECRET)
  const tampered = state.replace('prov-1', 'prov-evil')
  assertEquals(await verifyState(tampered, nonce, SECRET), null)
})

Deno.test('rejects a wrong signing secret', async () => {
  const { state, nonce } = await signState('prov-1', SECRET)
  assertEquals(await verifyState(state, nonce, 'wrong-secret'), null)
})

Deno.test('rejects an expired state', async () => {
  const past = Date.now() - 20 * 60 * 1000 // 20 min ago (TTL is 10)
  const { state, nonce } = await signState('prov-1', SECRET, past)
  assertEquals(await verifyState(state, nonce, SECRET), null)
})

Deno.test('rejects a malformed state', async () => {
  assertEquals(await verifyState('not-a-valid-state', 'n', SECRET), null)
  assertEquals(await verifyState('', 'n', SECRET), null)
})

Deno.test('readCookie pulls the nonce out of a Cookie header', () => {
  const { nonce } = { nonce: 'abc123' }
  const header = `other=1; ${OAUTH_STATE_COOKIE}=${nonce}; more=2`
  assertEquals(readCookie(header, OAUTH_STATE_COOKIE), 'abc123')
  assertEquals(readCookie(null, OAUTH_STATE_COOKIE), null)
})

Deno.test('cookie helpers set HttpOnly+Secure+SameSite and a max-age', () => {
  const set = stateCookie('abc')
  assertEquals(set.includes('HttpOnly'), true)
  assertEquals(set.includes('Secure'), true)
  assertEquals(set.includes('SameSite=Lax'), true)
  assertEquals(clearStateCookie().includes('Max-Age=0'), true)
})
