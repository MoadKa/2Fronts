import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  CONFIRM_TOKEN_PARAM,
  CONSENT_MAIL_IGNORE_SENTENCE,
  CONSENT_MAIL_SUBJECT,
  buildConfirmUrl,
  buildConsentMail,
  type ConsentMailConcierge,
  signConfirmToken,
  verifyConfirmToken,
} from './consentMail.ts'

const SECRET = 'test-consent-confirm-secret'
const TOKEN = 'AbCdEfGh01234567_-xyzXYZ'
const CONFIRM_URL = 'https://ref.functions.test/functions/v1/concierge-consent-confirm?t=abc123.sig456'

// A concierge row exactly as it comes out of the table, booking link and all.
// Handing the whole row to the mail builder is the realistic call, and the
// tests below prove the builder ignores everything it is not allowed to use.
const CALENDAR_URL = 'https://cal.example.test/coach-meier/erstgespraech'

const CONCIERGE: ConsentMailConcierge = {
  business_name: 'Coach Meier',
  language: 'de',
  calendar_url: CALENDAR_URL,
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function mail(overrides: Partial<ConsentMailConcierge> = {}, locale?: 'de' | 'en') {
  const built = buildConsentMail({
    concierge: { ...CONCIERGE, ...overrides },
    confirmUrl: CONFIRM_URL,
    locale,
  })
  assert(built, 'expected a mail to be built')
  return built
}

// --- The confirm link, once and only once ----------------------------------

Deno.test('the confirm URL appears exactly once in the text body and once in the html', () => {
  for (const locale of ['de', 'en'] as const) {
    const m = mail({}, locale)
    assertEquals(occurrences(m.text, CONFIRM_URL), 1, `text body, ${locale}`)
    assertEquals(occurrences(m.html, CONFIRM_URL), 1, `html body, ${locale}`)
    // In the html it lives in the href and nowhere else.
    assertStringIncludes(m.html, `href="${CONFIRM_URL}"`)
  }
})

Deno.test('the confirm link is the only link in the mail', () => {
  const m = mail()
  assertEquals(occurrences(m.text, 'http'), 1)
  assertEquals(occurrences(m.html, 'href='), 1)
  assertEquals(occurrences(m.html, 'http'), 1)
})

// --- Content-free: no booking link, no offer, no second call to action ------

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
  // Still exactly one link.
  assertEquals(occurrences(m.text, 'http'), 1)
})

Deno.test('a booking link smuggled through the sender block is stripped, the address survives', () => {
  const m = mail({
    followup_sender_block: 'Coach Meier GmbH\nMusterweg 3, 45127 Essen\nTermine: https://cal.example.test/slot\nmoin@example.test',
  })
  assert(!m.text.includes('cal.example.test'))
  assert(!m.html.includes('cal.example.test'))
  assertStringIncludes(m.text, 'Musterweg 3, 45127 Essen')
  assertStringIncludes(m.html, 'Musterweg 3, 45127 Essen')
  assertStringIncludes(m.text, 'moin@example.test')
  assertEquals(occurrences(m.text, 'http'), 1)
})

Deno.test('extra columns handed over with the row change no byte of the mail', () => {
  // The realistic call passes the whole row. Anything the builder is not
  // allowed to use must be invisible in the output, including the offer.
  const noisy = {
    ...CONCIERGE,
    offer_description: 'GEHEIMES ANGEBOT 3000 Euro',
    qa: 'Frage: Was kostet es?',
    tone: 'friendly',
    // The follow-up sender columns belong to the follow-up mail, not to this
    // one. Only followup_sender_block is read here.
    followup_privacy_url: 'https://coach-meier.example.test/datenschutz',
    followup_reply_to: 'coach@example.test',
  } as ConsentMailConcierge
  const withNoise = buildConsentMail({ concierge: noisy, confirmUrl: CONFIRM_URL })
  assert(withNoise)
  assert(!withNoise.text.includes('coach-meier.example.test'))
  assert(!withNoise.text.includes('coach@example.test'))
  const plain = mail()
  assertEquals(withNoise.text, plain.text)
  assertEquals(withNoise.html, plain.html)
})

Deno.test('no sender block means no dangling blank block', () => {
  const m = mail()
  assert(!m.text.includes('\n\n\n'), 'an empty sender block left a hole in the text body')
  assert(m.text.endsWith('im Auftrag von Coach Meier.\n'))
})

// --- The mail says the four things it is allowed to say ---------------------

Deno.test('the German subject is the agreed line', () => {
  assertEquals(mail({}, 'de').subject, 'Bitte bestätige deine E-Mail-Adresse')
  assertEquals(CONSENT_MAIL_SUBJECT.de, 'Bitte bestätige deine E-Mail-Adresse')
  assertEquals(mail({}, 'en').subject, 'Please confirm your email address')
})

Deno.test('the "ignoring this costs you nothing" sentence is present in both locales, in both bodies', () => {
  for (const locale of ['de', 'en'] as const) {
    const m = mail({}, locale)
    assertStringIncludes(m.text, CONSENT_MAIL_IGNORE_SENTENCE[locale])
    assertStringIncludes(m.html, CONSENT_MAIL_IGNORE_SENTENCE[locale])
  }
  assertStringIncludes(CONSENT_MAIL_IGNORE_SENTENCE.de, 'passiert nichts')
  assertStringIncludes(CONSENT_MAIL_IGNORE_SENTENCE.de, 'keine weitere E-Mail')
  assertStringIncludes(CONSENT_MAIL_IGNORE_SENTENCE.en, 'nothing happens')
  assertStringIncludes(CONSENT_MAIL_IGNORE_SENTENCE.en, 'not get another email')
})

Deno.test('the mail names who is asking, in both bodies', () => {
  const m = mail()
  assertStringIncludes(m.text, 'Coach Meier')
  assertStringIncludes(m.html, 'Coach Meier')
  assertStringIncludes(m.text, '2Fronts verschickt diese E-Mail im Auftrag von Coach Meier.')
})

Deno.test('the sender block is rendered when the concierge has one', () => {
  const m = mail({ followup_sender_block: 'Coach Meier GmbH\nMusterweg 3, 45127 Essen' })
  assertStringIncludes(m.text, 'Coach Meier GmbH\nMusterweg 3, 45127 Essen')
  assertStringIncludes(m.html, 'Coach Meier GmbH<br>Musterweg 3, 45127 Essen')
})

// --- German house style -----------------------------------------------------

Deno.test('the German mail contains no em dash and no en dash', () => {
  const m = mail({ followup_sender_block: 'Coach Meier GmbH\nMusterweg 3' }, 'de')
  for (const body of [m.subject, m.text, m.html]) {
    assert(!body.includes('—'), 'em dash in the German mail')
    assert(!body.includes('–'), 'en dash in the German mail')
  }
})

Deno.test('the German mail uses the du-form', () => {
  const m = mail({}, 'de')
  assertStringIncludes(m.text, 'du hast bei Coach Meier angegeben')
  assertStringIncludes(m.text, 'Bitte bestätige')
  // Sie-form would show up as a capitalised pronoun in these positions.
  assert(!m.text.includes('Ihre E-Mail-Adresse'))
  assert(!m.text.includes('Bitte bestätigen Sie'))
})

// --- Escaping and locale ----------------------------------------------------

Deno.test('a business name with markup is escaped in the html body', () => {
  const m = mail({ business_name: 'Meier & <b>Söhne</b>' })
  assert(!m.html.includes('<b>Söhne</b>'))
  assertStringIncludes(m.html, 'Meier &amp; &lt;b&gt;Söhne&lt;/b&gt;')
  // The plain-text body keeps the characters as typed.
  assertStringIncludes(m.text, 'Meier & <b>Söhne</b>')
})

Deno.test('the locale falls back to the concierge language and lands in html lang', () => {
  const en = buildConsentMail({
    concierge: { business_name: 'Coach Meier', language: 'en' },
    confirmUrl: CONFIRM_URL,
  })
  assert(en)
  assertEquals(en.subject, CONSENT_MAIL_SUBJECT.en)
  assertStringIncludes(en.html, '<html lang="en">')

  // An explicit locale (the one the consent was given in) wins over the row.
  const de = buildConsentMail({
    concierge: { business_name: 'Coach Meier', language: 'en' },
    confirmUrl: CONFIRM_URL,
    locale: 'de',
  })
  assert(de)
  assertEquals(de.subject, CONSENT_MAIL_SUBJECT.de)
  assertStringIncludes(de.html, '<html lang="de">')
})

// --- Refusals: nothing lawful to send --------------------------------------

Deno.test('no business name means no mail', () => {
  assertEquals(buildConsentMail({ concierge: { business_name: '   ' }, confirmUrl: CONFIRM_URL }), null)
  // A name that was nothing but a link is also nothing.
  assertEquals(
    buildConsentMail({ concierge: { business_name: 'https://cal.example.test' }, confirmUrl: CONFIRM_URL }),
    null,
  )
})

Deno.test('a non-https confirm URL is refused', () => {
  for (
    const bad of [
      '',
      'http://evil.test/confirm',
      'javascript:alert(1)',
      'ftp://x.test/t',
      'https://ok.test/c?t=a b',
      'https://ok.test/c?t="onmouseover=x',
    ]
  ) {
    assertEquals(buildConsentMail({ concierge: CONCIERGE, confirmUrl: bad }), null, `accepted ${bad}`)
  }
  // Loopback over http stays usable for local runs.
  assert(buildConsentMail({ concierge: CONCIERGE, confirmUrl: 'http://localhost:54321/x?t=a.b' }))
})

// --- The signed token -------------------------------------------------------

Deno.test('a signed token round-trips', async () => {
  const signed = await signConfirmToken(TOKEN, SECRET)
  assert(signed)
  assertEquals(signed.split('.').length, 2)
  assertEquals(signed.split('.')[0], TOKEN)
  assertEquals(await verifyConfirmToken(signed, SECRET), TOKEN)
})

Deno.test('a tampered token, a tampered signature and a foreign secret all fail closed', async () => {
  const signed = await signConfirmToken(TOKEN, SECRET)
  assert(signed)
  const [token, sig] = signed.split('.')

  assertEquals(await verifyConfirmToken(`${token}X.${sig}`, SECRET), null)
  assertEquals(await verifyConfirmToken(`${token}.${sig.slice(0, -1)}A`, SECRET), null)
  assertEquals(await verifyConfirmToken(signed, 'a-different-secret'), null)
  assertEquals(await verifyConfirmToken(token, SECRET), null)
  assertEquals(await verifyConfirmToken(`${token}.${sig}.extra`, SECRET), null)
  assertEquals(await verifyConfirmToken(null, SECRET), null)
  assertEquals(await verifyConfirmToken(signed, ''), null)
  // Oversized input is dropped before it is hashed.
  assertEquals(await verifyConfirmToken(`${'A'.repeat(400)}.${sig}`, SECRET), null)
  // A token of the wrong shape never reaches the hash either.
  assertEquals(await verifyConfirmToken(`sho.rt`, SECRET), null)
})

Deno.test('signing refuses a malformed token or a missing secret', async () => {
  assertEquals(await signConfirmToken(TOKEN, ''), null)
  assertEquals(await signConfirmToken('too-short', SECRET), null)
  assertEquals(await signConfirmToken('has spaces in it and is long', SECRET), null)
})

Deno.test('buildConfirmUrl puts the signed token in the t parameter', async () => {
  const url = await buildConfirmUrl(
    'https://ref.functions.test/functions/v1/concierge-consent-confirm',
    TOKEN,
    SECRET,
  )
  assert(url)
  const parsed = new URL(url)
  assertEquals(parsed.protocol, 'https:')
  assertEquals(parsed.pathname, '/functions/v1/concierge-consent-confirm')
  const t = parsed.searchParams.get(CONFIRM_TOKEN_PARAM)
  assert(t)
  assertEquals(await verifyConfirmToken(t, SECRET), TOKEN)
})

Deno.test('buildConfirmUrl refuses plaintext http off loopback, and anything unparseable', async () => {
  assertEquals(await buildConfirmUrl('http://ref.functions.test/x', TOKEN, SECRET), null)
  assertEquals(await buildConfirmUrl('not a url', TOKEN, SECRET), null)
  assertEquals(await buildConfirmUrl('', TOKEN, SECRET), null)
  assertEquals(await buildConfirmUrl('https://ok.test/x', TOKEN, ''), null)
  assert(await buildConfirmUrl('http://localhost:54321/functions/v1/concierge-consent-confirm', TOKEN, SECRET))
})

Deno.test('a mail built from a real signed link carries that link once', async () => {
  const url = await buildConfirmUrl('https://ref.functions.test/functions/v1/concierge-consent-confirm', TOKEN, SECRET)
  assert(url)
  const m = buildConsentMail({ concierge: CONCIERGE, confirmUrl: url })
  assert(m)
  assertEquals(occurrences(m.text, url), 1)
  assertEquals(occurrences(m.html, url), 1)
})
