import { assertEquals, assertNotEquals, assertRejects } from 'jsr:@std/assert@1'
import { decryptToken, encryptToken } from './tokenCrypto.ts'

// A deterministic 32-byte (256-bit) test key, base64-encoded. This is a TEST
// value only; production reads the real key from the CONNECTOR_TOKEN_KEY secret.
const TEST_KEY_B64 = btoa('0123456789abcdef0123456789abcdef')

function setTestKey() {
  Deno.env.set('CONNECTOR_TOKEN_KEY', TEST_KEY_B64)
}

Deno.test('encryptToken/decryptToken round-trips the original plaintext', async () => {
  setTestKey()
  const secret = 'ya29.fake-refresh-token-value'

  const ciphertext = await encryptToken(secret)
  const recovered = await decryptToken(ciphertext)

  assertEquals(recovered, secret)
})

Deno.test('ciphertext does not contain the plaintext', async () => {
  setTestKey()
  const secret = 'super-secret-refresh-token'

  const ciphertext = await encryptToken(secret)

  assertEquals(ciphertext.includes(secret), false)
})

Deno.test('two encryptions of the same plaintext differ (random IV)', async () => {
  setTestKey()
  const secret = 'identical-plaintext'

  const a = await encryptToken(secret)
  const b = await encryptToken(secret)

  assertNotEquals(a, b)
  // ...but both still decrypt back to the same original.
  assertEquals(await decryptToken(a), secret)
  assertEquals(await decryptToken(b), secret)
})

Deno.test('throws when CONNECTOR_TOKEN_KEY is missing', async () => {
  Deno.env.delete('CONNECTOR_TOKEN_KEY')
  await assertRejects(() => encryptToken('anything'), Error, 'CONNECTOR_TOKEN_KEY is not configured')
})

Deno.test('throws when the key is not 32 bytes', async () => {
  Deno.env.set('CONNECTOR_TOKEN_KEY', btoa('too-short'))
  await assertRejects(() => encryptToken('anything'), Error, 'must decode to 32 bytes')
})
