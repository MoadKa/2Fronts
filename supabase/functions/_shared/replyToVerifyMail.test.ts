import { assert, assertEquals, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  buildReplyToVerifyMail,
  buildReplyToVerifyUrl,
  normalizeReplyTo,
  REPLY_TO_VERIFY_IGNORE_SENTENCE,
  REPLY_TO_VERIFY_SUBJECT,
  REPLY_TO_VERIFY_TOKEN_PARAM,
  type ReplyToVerifyMailConcierge,
  replyToDigest,
  signReplyToVerifyToken,
  verifyReplyToVerifyToken,
} from './replyToVerifyMail.ts'

const SECRET = 'test-reply-to-verify-secret'
const CONCIERGE_ID = '11111111-2222-4333-8444-555555555555'
const OTHER_ID = '99999999-8888-4777-8666-555555555555'
const REPLY_TO = 'hallo@acme.de'
const VERIFY_URL =
  'https://2fronts.de/absender-bestaetigen?t=v1.11111111-2222-4333-8444-555555555555.AAAA.BBBB'

const CALENDAR_URL = 'https://cal.example.test/coach-meier/erstgespraech'

// The concierge row exactly as it comes out of the table, booking link and all.
// Handing the whole row over is the realistic call; the tests below prove the
// builder ignores everything it is not allowed to use.
const CONCIERGE: ReplyToVerifyMailConcierge = {
  business_name: 'Coach Meier',
  language: 'de',
  calendar_url: CALENDAR_URL,
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function mail(overrides: Partial<ReplyToVerifyMailConcierge> = {}, locale?: 'de' | 'en') {
  const built = buildReplyToVerifyMail({
    concierge: { ...CONCIERGE, ...overrides },
    verifyUrl: VERIFY_URL,
    locale,
  })
  assert(built, 'expected a mail to be built')
  return built
}

// --- The verification link, once and only once ------------------------------

Deno.test('the verify URL appears exactly once in the text body and once in the html', () => {
  for (const locale of ['de', 'en'] as const) {
    const m = mail({}, locale)
    assertEquals(occurrences(m.text, VERIFY_URL), 1, `text body, ${locale}`)
    assertEquals(occurrences(m.html, VERIFY_URL), 1, `html body, ${locale}`)
    // In the html it lives in the href and nowhere else.
    assertStringIncludes(m.html, `href="${VERIFY_URL}"`)
  }
})

Deno.test('the verification link is the only link in the mail', () => {
  for (const locale of ['de', 'en'] as const) {
    const m = mail({}, locale)
    assertEquals(occurrences(m.text, 'http'), 1)
    assertEquals(occurrences(m.html, 'href='), 1)
    assertEquals(occurrences(m.html, 'http'), 1)
  }
})

// --- Content-free: no offer, no booking link, no marketing ------------------

Deno.test('no booking or calendar URL reaches the mail, even though the row carries one', () => {
  for (const locale of ['de', 'en'] as const) {
    const m = mail({}, locale)
    for (const body of [m.subject, m.text, m.html]) {
      assert(!body.includes('cal.example.test'), 'the calendar host reached the mail')
      assert(!body.includes(CALENDAR_URL), 'the calendar URL reached the mail')
    }
  }
})

Deno.test('a booking link smuggled through the business name is stripped', () => {
  const m = mail({ business_name: 'Coach Meier // jetzt buchen: https://cal.example.test/slot' })
  assert(!m.text.includes('cal.example.test'))
  assert(!m.html.includes('cal.example.test'))
  assertStringIncludes(m.text, 'Coach Meier')
  assertEquals(occurrences(m.text, 'http'), 1)
})

Deno.test('the mail carries no marketing vocabulary and no second call to action', () => {
  const forbidden = [
    'jetzt buchen',
    'termin',
    'angebot',
    'kostenlos',
    'gratis',
    'exklusiv',
    'upgrade',
    'newsletter',
    'book now',
    'free trial',
    'offer',
    'discount',
  ]
  for (const locale of ['de', 'en'] as const) {
    const m = mail({}, locale)
    const haystack = `${m.subject}\n${m.text}`.toLowerCase()
    for (const word of forbidden) {
      assert(!haystack.includes(word), `"${word}" reached the ${locale} mail`)
    }
  }
})

// --- German house style ------------------------------------------------------

Deno.test('the German mail uses du-form and no em or en dash', () => {
  const m = mail({}, 'de')
  const body = `${m.subject}\n${m.text}`
  assert(!body.includes('—'), 'an em dash reached the German mail')
  assert(!body.includes('–'), 'an en dash reached the German mail')
  // du-form, not Sie.
  assert(!/\bSie\b/.test(body), 'the German mail addressed the coach as Sie')
  assertStringIncludes(body, 'du hast')
  assertStringIncludes(body, 'Bitte bestätige')
})

Deno.test('the mail says plainly what happens if the coach ignores it', () => {
  for (const locale of ['de', 'en'] as const) {
    const m = mail({}, locale)
    assertStringIncludes(m.text, REPLY_TO_VERIFY_IGNORE_SENTENCE[locale])
    assertStringIncludes(m.html, REPLY_TO_VERIFY_IGNORE_SENTENCE[locale])
  }
  // And it names the consequence, not a vague "you might miss something".
  assertStringIncludes(REPLY_TO_VERIFY_IGNORE_SENTENCE.de, 'keine Nachfass-E-Mail')
  assertStringIncludes(REPLY_TO_VERIFY_IGNORE_SENTENCE.en, 'will not send any follow-up email')
})

Deno.test('the language follows the concierge row, and the subject follows the language', () => {
  assertEquals(mail({ language: 'en' }).subject, REPLY_TO_VERIFY_SUBJECT.en)
  assertEquals(mail({ language: 'de' }).subject, REPLY_TO_VERIFY_SUBJECT.de)
  // Anything else falls back to German: the product is sold in German.
  assertEquals(mail({ language: 'fr' }).subject, REPLY_TO_VERIFY_SUBJECT.de)
  assertStringIncludes(mail({ language: 'en' }).html, '<html lang="en">')
})

// --- Refusals ----------------------------------------------------------------

Deno.test('a mail is not built without a business name or with an unusable URL', () => {
  assertEquals(buildReplyToVerifyMail({ concierge: { business_name: '   ' }, verifyUrl: VERIFY_URL }), null)
  assertEquals(
    buildReplyToVerifyMail({ concierge: { business_name: 'https://only-a-link.test' }, verifyUrl: VERIFY_URL }),
    null,
  )
  for (
    const url of [
      '',
      'not-a-url',
      'javascript:alert(1)',
      'http://evil.test/x',
      'https://2fronts.de/x"onmouseover=1',
      'https://2fronts.de/x y',
    ]
  ) {
    assertEquals(buildReplyToVerifyMail({ concierge: CONCIERGE, verifyUrl: url }), null, `url ${url}`)
  }
})

// --- The token: it binds the concierge AND the address ----------------------

Deno.test('a signed token round-trips to the concierge id and the address digest', async () => {
  const t = await signReplyToVerifyToken(CONCIERGE_ID, REPLY_TO, SECRET)
  assert(t)
  const claim = await verifyReplyToVerifyToken(t, SECRET)
  assert(claim)
  assertEquals(claim.conciergeId, CONCIERGE_ID)
  assertEquals(claim.addressDigest, await replyToDigest(REPLY_TO, SECRET))
})

Deno.test('the token never carries the address in the clear', async () => {
  const t = await signReplyToVerifyToken(CONCIERGE_ID, REPLY_TO, SECRET)
  assert(t)
  assert(!t.includes(REPLY_TO))
  assert(!t.includes('acme.de'))
  assert(!t.includes('hallo'))
})

Deno.test('a different address produces a different digest, so the binding is real', async () => {
  const a = await signReplyToVerifyToken(CONCIERGE_ID, REPLY_TO, SECRET)
  const b = await signReplyToVerifyToken(CONCIERGE_ID, 'anders@acme.de', SECRET)
  assert(a && b)
  assertNotEquals(a, b)
  const claimA = await verifyReplyToVerifyToken(a, SECRET)
  const claimB = await verifyReplyToVerifyToken(b, SECRET)
  assert(claimA && claimB)
  assertEquals(claimA.conciergeId, claimB.conciergeId)
  assertNotEquals(claimA.addressDigest, claimB.addressDigest)
})

Deno.test('the address digest ignores case and surrounding whitespace, nothing else', async () => {
  assertEquals(normalizeReplyTo('  Hallo@Acme.DE '), 'hallo@acme.de')
  assertEquals(await replyToDigest('  Hallo@Acme.DE ', SECRET), await replyToDigest(REPLY_TO, SECRET))
  assertNotEquals(await replyToDigest('hallo+tag@acme.de', SECRET), await replyToDigest(REPLY_TO, SECRET))
  // No secret, no digest: two nulls must never compare equal into a pass.
  assertEquals(await replyToDigest(REPLY_TO, ''), null)
  assertEquals(await replyToDigest('', SECRET), null)
  assertEquals(await replyToDigest('x'.repeat(400), SECRET), null)
})

Deno.test('the digest is keyed, so a leaked URL cannot be run against an address list', async () => {
  assertNotEquals(await replyToDigest(REPLY_TO, SECRET), await replyToDigest(REPLY_TO, 'other-secret'))
})

Deno.test('verification fails closed on every malformed or forged token', async () => {
  const t = await signReplyToVerifyToken(CONCIERGE_ID, REPLY_TO, SECRET)
  assert(t)
  const [version, id, digest, sig] = t.split('.')

  const cases: Array<string | null | undefined> = [
    null,
    undefined,
    '',
    'nonsense',
    `${version}.${id}.${digest}`, // no signature
    `${version}.${id}.${digest}.${sig}.extra`,
    `v2.${id}.${digest}.${sig}`, // unknown version
    `${version}.not-a-uuid.${digest}.${sig}`,
    `${version}.${OTHER_ID}.${digest}.${sig}`, // another setter's id under our signature
    `${version}.${id}.${digest}.${sig.slice(0, -1)}A`, // tampered signature
    `${version}.${id}.${'A'.repeat(43)}.${sig}`, // swapped digest
    `${version}.${id}.${digest}A.${sig}`, // wrong digest length
    `${'x'.repeat(300)}`, // oversized
  ]
  for (const value of cases) {
    assertEquals(await verifyReplyToVerifyToken(value, SECRET), null, `case ${value}`)
  }

  // A token signed with someone else's secret is refused.
  const foreign = await signReplyToVerifyToken(CONCIERGE_ID, REPLY_TO, 'someone-elses-secret')
  assert(foreign)
  assertEquals(await verifyReplyToVerifyToken(foreign, SECRET), null)
  // And no secret means no verification at all.
  assertEquals(await verifyReplyToVerifyToken(t, ''), null)
})

Deno.test('signing refuses a non-UUID concierge, an empty address or a missing secret', async () => {
  assertEquals(await signReplyToVerifyToken('not-a-uuid', REPLY_TO, SECRET), null)
  assertEquals(await signReplyToVerifyToken(CONCIERGE_ID, '  ', SECRET), null)
  assertEquals(await signReplyToVerifyToken(CONCIERGE_ID, REPLY_TO, ''), null)
})

// --- The URL -----------------------------------------------------------------

Deno.test('buildReplyToVerifyUrl puts the signed token in the t parameter', async () => {
  const url = await buildReplyToVerifyUrl(
    'https://2fronts.de/absender-bestaetigen',
    CONCIERGE_ID,
    REPLY_TO,
    SECRET,
  )
  assert(url)
  const parsed = new URL(url)
  assertEquals(parsed.origin + parsed.pathname, 'https://2fronts.de/absender-bestaetigen')
  const t = parsed.searchParams.get(REPLY_TO_VERIFY_TOKEN_PARAM)
  assert(t)
  const claim = await verifyReplyToVerifyToken(t, SECRET)
  assert(claim)
  assertEquals(claim.conciergeId, CONCIERGE_ID)
  // The address is not in the URL.
  assert(!url.includes('acme.de'))
})

Deno.test('buildReplyToVerifyUrl refuses plain http except on loopback, and never throws', async () => {
  assertEquals(await buildReplyToVerifyUrl('http://2fronts.de/x', CONCIERGE_ID, REPLY_TO, SECRET), null)
  assertEquals(await buildReplyToVerifyUrl('not a url', CONCIERGE_ID, REPLY_TO, SECRET), null)
  assertEquals(await buildReplyToVerifyUrl('', CONCIERGE_ID, REPLY_TO, SECRET), null)
  assert(await buildReplyToVerifyUrl('http://localhost:54421/x', CONCIERGE_ID, REPLY_TO, SECRET))
  assert(await buildReplyToVerifyUrl('http://127.0.0.1:54421/x', CONCIERGE_ID, REPLY_TO, SECRET))
  // A missing secret loses the URL rather than shipping an unverifiable link.
  assertEquals(await buildReplyToVerifyUrl('https://2fronts.de/x', CONCIERGE_ID, REPLY_TO, ''), null)
})
