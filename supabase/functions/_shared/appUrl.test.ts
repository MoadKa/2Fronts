import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { resolveAppBaseUrl } from './appUrl.ts'

// Regression test for the production incident where PUBLIC_APP_URL on the
// deployed project still held a localhost dev value, so Stripe redirected paid
// customers to http://localhost after checkout (create-checkout-session builds
// success_url/cancel_url from this env var). The guard turns a silent
// misconfiguration into a loud, fail-fast error.

Deno.test('returns the URL unchanged for a valid https public URL', () => {
  assertEquals(resolveAppBaseUrl('https://2fronts.de'), 'https://2fronts.de')
})

Deno.test('strips a trailing slash so success_url has no double slash', () => {
  assertEquals(resolveAppBaseUrl('https://2fronts.de/'), 'https://2fronts.de')
})

Deno.test('throws when PUBLIC_APP_URL is undefined', () => {
  assertThrows(() => resolveAppBaseUrl(undefined), Error, 'not configured')
})

Deno.test('throws when PUBLIC_APP_URL is an empty string', () => {
  assertThrows(() => resolveAppBaseUrl('   '), Error, 'not configured')
})

Deno.test('throws when PUBLIC_APP_URL is not a parseable URL', () => {
  assertThrows(() => resolveAppBaseUrl('2fronts.de'), Error, 'valid URL')
})

Deno.test('throws when PUBLIC_APP_URL points to localhost (the actual prod bug)', () => {
  assertThrows(() => resolveAppBaseUrl('http://localhost:5173'), Error, 'local address')
})

Deno.test('throws for 127.0.0.1 loopback', () => {
  assertThrows(() => resolveAppBaseUrl('http://127.0.0.1:5173'), Error, 'local address')
})

Deno.test('throws when the public URL is not https', () => {
  assertThrows(() => resolveAppBaseUrl('http://2fronts.de'), Error, 'https')
})

Deno.test('allows localhost when the explicit dev escape hatch is set', () => {
  assertEquals(
    resolveAppBaseUrl('http://localhost:5173', true),
    'http://localhost:5173',
  )
})
