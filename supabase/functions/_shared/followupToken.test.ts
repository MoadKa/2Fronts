import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  buildListUnsubscribeHeaders,
  buildUnsubscribeUrl,
  signUnsubscribeToken,
  UNSUBSCRIBE_PARAM_MAX_LEN,
  verifyUnsubscribeToken,
} from './followupToken.ts'

const SECRET = 'current-followup-unsub-secret'
const PREVIOUS = 'previous-followup-unsub-secret'
const CONCIERGE = '11111111-2222-4333-8444-555555555555'
const CONVERSATION = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const BASE = 'https://2fronts.de/abmelden'

async function token(secret = SECRET): Promise<string> {
  const t = await signUnsubscribeToken(CONCIERGE, CONVERSATION, secret)
  assert(t, 'expected a signed token')
  return t
}

// --- Format -----------------------------------------------------------------

Deno.test('the token is v1.<concierge>.<conversation>.<sig>', async () => {
  const t = await token()
  const parts = t.split('.')
  assertEquals(parts.length, 4)
  assertEquals(parts[0], 'v1')
  assertEquals(parts[1], CONCIERGE)
  assertEquals(parts[2], CONVERSATION)
  // b64url of a SHA-256 digest, unpadded.
  assertEquals(parts[3].length, 43)
  assert(/^[A-Za-z0-9_-]+$/.test(parts[3]))
  assert(t.length <= UNSUBSCRIBE_PARAM_MAX_LEN)
})

Deno.test('signing is deterministic and secret-dependent', async () => {
  assertEquals(await token(), await token())
  assert((await token()) !== (await token(PREVIOUS)))
})

Deno.test('signing refuses a missing secret or a non-UUID id', async () => {
  assertEquals(await signUnsubscribeToken(CONCIERGE, CONVERSATION, ''), null)
  assertEquals(await signUnsubscribeToken('not-a-uuid', CONVERSATION, SECRET), null)
  assertEquals(await signUnsubscribeToken(CONCIERGE, 'not-a-uuid', SECRET), null)
  // No SQL-ish or path-ish id can ever survive into a token.
  assertEquals(await signUnsubscribeToken(`${CONCIERGE}' or 1=1--`, CONVERSATION, SECRET), null)
})

// --- Verification -----------------------------------------------------------

Deno.test('a token signed with the current secret verifies', async () => {
  const claim = await verifyUnsubscribeToken(await token(), SECRET, PREVIOUS)
  assertEquals(claim, { conciergeId: CONCIERGE, conversationId: CONVERSATION })
})

Deno.test('ROTATION: a token signed with the PREVIOUS secret verifies when previous is supplied, and fails when it is not', async () => {
  const old = await token(PREVIOUS)

  // The link is in somebody's inbox and the secret has just been rotated. With
  // the fallback wired it still works.
  assertEquals(await verifyUnsubscribeToken(old, SECRET, PREVIOUS), {
    conciergeId: CONCIERGE,
    conversationId: CONVERSATION,
  })

  // Drop the fallback and every one of those links dies silently. This
  // assertion is the whole reason the parameter exists.
  assertEquals(await verifyUnsubscribeToken(old, SECRET), null)
  assertEquals(await verifyUnsubscribeToken(old, SECRET, ''), null)
  assertEquals(await verifyUnsubscribeToken(old, SECRET, null), null)
})

Deno.test('the current secret keeps working while a previous one is configured', async () => {
  assertEquals(await verifyUnsubscribeToken(await token(), SECRET, PREVIOUS), {
    conciergeId: CONCIERGE,
    conversationId: CONVERSATION,
  })
})

Deno.test('a token signed with neither secret is refused', async () => {
  const forged = await token('some-third-secret')
  assertEquals(await verifyUnsubscribeToken(forged, SECRET, PREVIOUS), null)
})

Deno.test('a token WITHOUT the v1. prefix returns null', async () => {
  const t = await token()
  const [, concierge, conversation, sig] = t.split('.')
  // Same ids, same signature, no version tag.
  assertEquals(await verifyUnsubscribeToken(`${concierge}.${conversation}.${sig}`, SECRET), null)
  // A different version tag, correctly signed under v1's message, is also out.
  assertEquals(await verifyUnsubscribeToken(`v2.${concierge}.${conversation}.${sig}`, SECRET), null)
  assertEquals(await verifyUnsubscribeToken(`V1.${concierge}.${conversation}.${sig}`, SECRET), null)
})

Deno.test('verification fails closed on everything malformed', async () => {
  const t = await token()
  assertEquals(await verifyUnsubscribeToken(null, SECRET), null)
  assertEquals(await verifyUnsubscribeToken(undefined, SECRET), null)
  assertEquals(await verifyUnsubscribeToken('', SECRET), null)
  // No secret at all, not even a previous one.
  assertEquals(await verifyUnsubscribeToken(t, ''), null)
  assertEquals(await verifyUnsubscribeToken(t, '', ''), null)
  // Truncated by a mail client.
  assertEquals(await verifyUnsubscribeToken(t.slice(0, t.length - 4), SECRET), null)
  // Extra segment.
  assertEquals(await verifyUnsubscribeToken(`${t}.x`, SECRET), null)
  // Swapped ids: correctly signed for the other order, so this proves the
  // signature covers the ORDER and not just the set.
  const swapped = await signUnsubscribeToken(CONVERSATION, CONCIERGE, SECRET)
  assert(swapped)
  assertEquals(await verifyUnsubscribeToken(swapped, SECRET), {
    conciergeId: CONVERSATION,
    conversationId: CONCIERGE,
  })
  const spliced = `v1.${CONCIERGE}.${CONVERSATION}.${swapped.split('.')[3]}`
  assertEquals(await verifyUnsubscribeToken(spliced, SECRET), null)
})

Deno.test('an oversized parameter is dropped before a hash is spent', async () => {
  const huge = `v1.${CONCIERGE}.${CONVERSATION}.${'A'.repeat(UNSUBSCRIBE_PARAM_MAX_LEN)}`
  assert(huge.length > UNSUBSCRIBE_PARAM_MAX_LEN)
  assertEquals(await verifyUnsubscribeToken(huge, SECRET, PREVIOUS), null)
})

Deno.test('a signature of the wrong shape is refused without a compare', async () => {
  assertEquals(await verifyUnsubscribeToken(`v1.${CONCIERGE}.${CONVERSATION}.`, SECRET), null)
  assertEquals(await verifyUnsubscribeToken(`v1.${CONCIERGE}.${CONVERSATION}.short`, SECRET), null)
  // 43 characters, but not the b64url alphabet.
  assertEquals(
    await verifyUnsubscribeToken(`v1.${CONCIERGE}.${CONVERSATION}.${'*'.repeat(43)}`, SECRET),
    null,
  )
})

Deno.test('NO EXPIRY: an ancient token still verifies', async () => {
  // There is nothing time-shaped in the signed message, which is the mechanical
  // form of "an opt-out link must work forever". If a clock ever appears in the
  // token, this test is where it will be noticed.
  const t = await token()
  assert(!/\d{10}/.test(t.split('.')[3]), 'the signature must encode no timestamp')
  assertEquals(await verifyUnsubscribeToken(t, SECRET), {
    conciergeId: CONCIERGE,
    conversationId: CONVERSATION,
  })
})

// --- The URL in the mail ----------------------------------------------------

Deno.test('the unsubscribe URL is built on the configured 2fronts.de route', async () => {
  const url = await buildUnsubscribeUrl(BASE, CONCIERGE, CONVERSATION, SECRET)
  assert(url)
  const parsed = new URL(url)
  assertEquals(parsed.origin, 'https://2fronts.de')
  assertEquals(parsed.pathname, '/abmelden')
  assertEquals(await verifyUnsubscribeToken(parsed.searchParams.get('t'), SECRET), {
    conciergeId: CONCIERGE,
    conversationId: CONVERSATION,
  })
})

Deno.test('a subdomain of 2fronts.de is allowed, anything else is not', async () => {
  assert(await buildUnsubscribeUrl('https://www.2fronts.de/abmelden', CONCIERGE, CONVERSATION, SECRET))

  // The whole point: a link out of a mail must not point at the platform's
  // infrastructure host. It reads as a phish and gets reported as one.
  for (
    const bad of [
      'https://abcdef.supabase.co/functions/v1/concierge-followup-unsubscribe',
      'https://2fronts.de.evil.test/abmelden',
      'https://not2fronts.de/abmelden',
      'http://2fronts.de/abmelden',
      'http://localhost:54321/abmelden',
      'not a url',
      '',
      undefined,
    ]
  ) {
    assertEquals(
      await buildUnsubscribeUrl(bad, CONCIERGE, CONVERSATION, SECRET),
      null,
      `expected ${String(bad)} to be refused`,
    )
  }
})

Deno.test('an unbuildable URL yields null rather than a half-formed link', async () => {
  assertEquals(await buildUnsubscribeUrl(BASE, CONCIERGE, CONVERSATION, ''), null)
  assertEquals(await buildUnsubscribeUrl(BASE, 'nope', CONVERSATION, SECRET), null)
})

// --- RFC 8058 ---------------------------------------------------------------

Deno.test('the List-Unsubscribe headers ship as a pair or not at all', async () => {
  const url = await buildUnsubscribeUrl(BASE, CONCIERGE, CONVERSATION, SECRET)
  assert(url)
  const headers = buildListUnsubscribeHeaders(url)
  assertEquals(headers['List-Unsubscribe'], `<${url}>`)
  assertEquals(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')

  assertEquals(buildListUnsubscribeHeaders(null), {})
  // A URL carrying a header delimiter would corrupt the header it lands in.
  assertEquals(buildListUnsubscribeHeaders('https://2fronts.de/a b'), {})
  assertEquals(buildListUnsubscribeHeaders('https://2fronts.de/a,b'), {})
  assertEquals(buildListUnsubscribeHeaders('https://2fronts.de/a>b'), {})
})
