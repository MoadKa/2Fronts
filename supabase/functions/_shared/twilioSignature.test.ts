import { assertEquals } from 'jsr:@std/assert@1'
import { verifyTwilioSignature } from './twilioSignature.ts'

// Test vector from Twilio's own documentation
// (https://www.twilio.com/docs/usage/security#explore-the-algorithm-yourself).
// This was never independently verified before — every other test in this
// codebase only exercises this function indirectly through a mocked
// verifySignature dependency injection, never the real HMAC computation.
// Found by /ship's coverage audit on 2026-06-21 (a zero-coverage gap on a
// security-critical auth boundary for both Twilio webhooks).
const TWILIO_DOCS_AUTH_TOKEN = '12345'
const TWILIO_DOCS_URL = 'https://example.com/myapp.php?foo=1&bar=2'
const TWILIO_DOCS_PARAMS = {
  CallSid: 'CA1234567890ABCDE',
  Caller: '+14158675310',
  Digits: '1234',
  From: '+14158675310',
  To: '+18005551212',
}
const TWILIO_DOCS_EXPECTED_SIGNATURE = 'L/OH5YylLD5NRKLltdqwSvS0BnU='

Deno.test('matches Twilio\'s own documented worked example exactly', async () => {
  const result = await verifyTwilioSignature(TWILIO_DOCS_URL, TWILIO_DOCS_PARAMS, TWILIO_DOCS_EXPECTED_SIGNATURE, TWILIO_DOCS_AUTH_TOKEN)
  assertEquals(result, true)
})

Deno.test('rejects a signature that does not match', async () => {
  const result = await verifyTwilioSignature(TWILIO_DOCS_URL, TWILIO_DOCS_PARAMS, 'wrong-signature==', TWILIO_DOCS_AUTH_TOKEN)
  assertEquals(result, false)
})

Deno.test('rejects when the auth token is wrong (even with the correct signature for a different token)', async () => {
  const result = await verifyTwilioSignature(TWILIO_DOCS_URL, TWILIO_DOCS_PARAMS, TWILIO_DOCS_EXPECTED_SIGNATURE, 'wrong-token')
  assertEquals(result, false)
})

Deno.test('rejects when a form param value is tampered with', async () => {
  const tamperedParams = { ...TWILIO_DOCS_PARAMS, To: '+19999999999' }
  const result = await verifyTwilioSignature(TWILIO_DOCS_URL, tamperedParams, TWILIO_DOCS_EXPECTED_SIGNATURE, TWILIO_DOCS_AUTH_TOKEN)
  assertEquals(result, false)
})

Deno.test('rejects when the URL is tampered with', async () => {
  const result = await verifyTwilioSignature('https://attacker.com/myapp.php?foo=1&bar=2', TWILIO_DOCS_PARAMS, TWILIO_DOCS_EXPECTED_SIGNATURE, TWILIO_DOCS_AUTH_TOKEN)
  assertEquals(result, false)
})
