import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  FOLLOWUP_MAIL_SUBJECT,
  FOLLOWUP_NEUTRAL_CLOSING,
  FOLLOWUP_ONE_MAIL_SENTENCE,
  buildFollowupMail,
  clampLanguage,
  type FollowupMailConcierge,
  type FollowupMailInput,
  sanitizeVisitorName,
} from './followupContent.ts'

const CALENDAR_URL = 'https://cal.example.test/coach-meier/erstgespraech'
const PRIVACY_URL = 'https://coach-meier.example.test/datenschutz'
const UNSUBSCRIBE_URL = 'https://ref.functions.test/functions/v1/concierge-unsubscribe?u=abc123.sig456'
const SENDER_BLOCK = 'Coach Meier GmbH\nMusterweg 3, 45127 Essen'

const CONCIERGE: FollowupMailConcierge = {
  business_name: 'Coach Meier',
  language: 'de',
  calendar_url: CALENDAR_URL,
  followup_privacy_url: PRIVACY_URL,
  followup_sender_block: SENDER_BLOCK,
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

function mail(
  overrides: Partial<FollowupMailConcierge> = {},
  rest: Partial<Omit<FollowupMailInput, 'concierge'>> = {},
) {
  const built = buildFollowupMail({
    concierge: { ...CONCIERGE, ...overrides },
    unsubscribeUrl: UNSUBSCRIBE_URL,
    visitorName: 'Anna',
    ...rest,
  })
  assert(built, 'expected a mail to be built')
  return built
}

// --- clampLanguage ----------------------------------------------------------
//
// concierges.language has no CHECK constraint. Anything that is not exactly
// 'en' has to land on 'de', because the alternative is COPY[locale] returning
// undefined and a mail going out in the coach's name with the word "undefined"
// in it, or a queue worker throwing on a row nobody can see is malformed.

Deno.test('clampLanguage clamps every unexpected column value to de', () => {
  assertEquals(clampLanguage('DE'), 'de')
  assertEquals(clampLanguage('fr'), 'de')
  assertEquals(clampLanguage(''), 'de')
  assertEquals(clampLanguage(null), 'de')
  assertEquals(clampLanguage(undefined), 'de')
  // A few more shapes the column could hold once someone edits it by hand.
  assertEquals(clampLanguage('de-DE'), 'de')
  assertEquals(clampLanguage(' en'), 'de')
  assertEquals(clampLanguage(42), 'de')
  assertEquals(clampLanguage({}), 'de')
  // Only the exact value passes.
  assertEquals(clampLanguage('en'), 'en')
})

Deno.test("clampLanguage is NOT case-folded, so 'EN' gets the same language the chat spoke", () => {
  // concierge-chat/index.ts:950 does `intro.language === 'en' ? 'en' : 'de'`.
  // A row holding 'EN' therefore gets a German chat. If this module case-folded,
  // that visitor would read German on screen and get an English mail about the
  // same conversation.
  assertEquals(clampLanguage('EN'), 'de')
  assertEquals(mail({ language: 'EN' }).subject, FOLLOWUP_MAIL_SUBJECT.de('Coach Meier'))
})

Deno.test('an unclamped language never reaches the copy table', () => {
  for (const language of ['DE', 'fr', '', null, undefined, 'de-DE']) {
    const m = mail({ language })
    assertEquals(m.subject, 'Der Kalenderlink von Coach Meier')
    assert(!m.text.includes('undefined'), `"undefined" in the text body for language=${language}`)
    assert(!m.html.includes('undefined'), `"undefined" in the html body for language=${language}`)
    assertStringIncludes(m.html, '<html lang="de">')
  }
})

// --- sanitizeVisitorName ----------------------------------------------------
//
// The rule is: reject the shapes that could ever become a header, accept
// everything else VERBATIM. A letters-and-marks-only allow-list would pass this
// file's happy path and quietly turn a real fraction of real names into
// "Hallo," in a mail signed by the coach.

Deno.test('sanitizeVisitorName accepts the names a letters-only regex would eat', () => {
  for (
    const name of [
      "Anna-Lena O'Brien",
      'José Müller',
      'Max 2',
      'H. Özdemir',
      'Jean-Luc de la Tour',
      'Ana Sánchez-Ruiz',
      'Þórunn',
      '李雷',
      'Mohammed Al-Kaoukabi',
    ]
  ) {
    assertEquals(sanitizeVisitorName(name), name, `rejected a legitimate name: ${name}`)
  }
})

Deno.test('sanitizeVisitorName trims and keeps the inside exactly as typed', () => {
  assertEquals(sanitizeVisitorName('  Anna-Lena  O’Brien  '), 'Anna-Lena  O’Brien')
})

Deno.test('sanitizeVisitorName rejects header injection and oversized input', () => {
  // The classic payload. CR and LF are refused whether or not an '@' rides along.
  assertEquals(sanitizeVisitorName('Max\r\nBcc: x@y.z'), null)
  assertEquals(sanitizeVisitorName('Max\r\nBcc: mallory'), null)
  assertEquals(sanitizeVisitorName('Max\nX-Mailer: evil'), null)
  // Any other C0/C1 control, built rather than typed so this file stays text.
  assertEquals(sanitizeVisitorName(`Max${String.fromCharCode(0)}`), null)
  assertEquals(sanitizeVisitorName(`Max${String.fromCharCode(7)}Anna`), null)
  assertEquals(sanitizeVisitorName(`Max${String.fromCharCode(0x85)}Anna`), null)

  // 60 code points is the ceiling, 61 is one too many.
  const sixty = 'A'.repeat(60)
  assertEquals(sanitizeVisitorName(sixty), sixty)
  assertEquals(sanitizeVisitorName('A'.repeat(61)), null)
})

Deno.test('sanitizeVisitorName rejects address shapes and anything not starting with a letter', () => {
  assertEquals(sanitizeVisitorName('mallory@evil.test'), null)
  assertEquals(sanitizeVisitorName('Max <max@evil.test>'), null)
  assertEquals(sanitizeVisitorName('<b>Max</b>'), null)
  assertEquals(sanitizeVisitorName('"Max"'), null)
  assertEquals(sanitizeVisitorName('-- '), null)
  assertEquals(sanitizeVisitorName('   '), null)
  assertEquals(sanitizeVisitorName(''), null)
  assertEquals(sanitizeVisitorName(null), null)
  assertEquals(sanitizeVisitorName(undefined), null)
  assertEquals(sanitizeVisitorName(42), null)
})

Deno.test('an accepted name lands in the greeting verbatim, a rejected one greets without it', () => {
  const named = mail({}, { visitorName: "Anna-Lena O'Brien" })
  assertStringIncludes(named.text, "Hallo Anna-Lena O'Brien,")
  assertStringIncludes(named.html, "Hallo Anna-Lena O'Brien,")

  const anonymous = mail({}, { visitorName: 'Max\r\nBcc: x@y.z' })
  assertStringIncludes(anonymous.text, 'Hallo,')
  assert(!anonymous.text.includes('Bcc'))
  assert(!anonymous.html.includes('Bcc'))

  assertStringIncludes(mail({}, { visitorName: null }).text, 'Hallo,')
  assertStringIncludes(mail({ language: 'en' }, { visitorName: 'Anna' }).text, 'Hello Anna,')
})

Deno.test('a name with markup never reaches the html unescaped', () => {
  // '<' is refused outright, so the greeting falls back. Belt and braces: the
  // markup must not appear either way.
  const m = mail({}, { visitorName: 'Max <script>alert(1)</script>' })
  assert(!m.html.includes('<script>'))
  assertStringIncludes(m.text, 'Hallo,')
})

// --- Structure: the eight parts, in order -----------------------------------

Deno.test('the body carries greeting, recall, link, note, closing, sender block, privacy and unsubscribe, in that order', () => {
  const m = mail({}, { coachNote: 'Bring gern deine Zahlen aus den letzten drei Monaten mit.' })
  const order = [
    'Hallo Anna,',
    'du hast im Chat von Coach Meier geschrieben.',
    'Hier ist der Link zum Kalender noch einmal',
    CALENDAR_URL,
    'Bring gern deine Zahlen',
    FOLLOWUP_NEUTRAL_CLOSING.de,
    FOLLOWUP_ONE_MAIL_SENTENCE.de,
    'Musterweg 3, 45127 Essen',
    'Wie Coach Meier mit deinen Daten umgeht',
    PRIVACY_URL,
    'Du kannst deine Einwilligung jederzeit widerrufen',
    UNSUBSCRIBE_URL,
  ]
  let cursor = -1
  for (const part of order) {
    const at = m.text.indexOf(part, cursor + 1)
    assert(at > cursor, `out of order or missing in the text body: ${part}`)
    cursor = at
  }
})

Deno.test('a missing note or sender block leaves no hole in the plain text', () => {
  const m = mail({ followup_sender_block: null }, { coachNote: null })
  assert(!m.text.includes('\n\n\n'), 'an empty block left a hole in the text body')
  assert(m.text.endsWith(`${UNSUBSCRIBE_URL}\n`))
})

// --- The privacy line -------------------------------------------------------

Deno.test('the privacy line renders with the COACH’s URL, in both bodies', () => {
  const m = mail()
  assertStringIncludes(m.text, 'Wie Coach Meier mit deinen Daten umgeht, steht hier:')
  assertStringIncludes(m.text, PRIVACY_URL)
  assertStringIncludes(m.html, 'Wie Coach Meier mit deinen Daten umgeht, steht hier:')
  assertStringIncludes(m.html, `href="${PRIVACY_URL}"`)

  // A different coach's notice, not ours: 2fronts.de must not stand in for it.
  const other = mail({ followup_privacy_url: 'https://andere-coachin.example.test/privacy' })
  assertStringIncludes(other.text, 'https://andere-coachin.example.test/privacy')
  assert(!other.text.includes('2fronts.de/datenschutz'))

  const en = mail({ language: 'en' })
  assertStringIncludes(en.text, 'How Coach Meier handles your data is explained here:')
  assertStringIncludes(en.text, PRIVACY_URL)
})

Deno.test('the unsubscribe line renders with the signed URL, in both bodies', () => {
  const m = mail()
  assertStringIncludes(m.text, 'Du kannst deine Einwilligung jederzeit widerrufen, mit einem Klick:')
  assertStringIncludes(m.text, UNSUBSCRIBE_URL)
  assertStringIncludes(m.html, `href="${UNSUBSCRIBE_URL}"`)
})

// --- The booking link -------------------------------------------------------

Deno.test('the booking link appears exactly once in the text body and once in the html', () => {
  for (const locale of ['de', 'en'] as const) {
    const m = mail({}, { locale })
    assertEquals(occurrences(m.text, CALENDAR_URL), 1, `text body, ${locale}`)
    assertEquals(occurrences(m.html, CALENDAR_URL), 1, `html body, ${locale}`)
    // In the html it lives in the href of the one button and nowhere else.
    assertStringIncludes(m.html, `href="${CALENDAR_URL}"`)
  }
})

Deno.test('the mail carries three links and no fourth', () => {
  const m = mail({}, { coachNote: 'Bis dann.' })
  assertEquals(occurrences(m.text, 'http'), 3)
  assertEquals(occurrences(m.html, 'href='), 3)
})

// --- It must never claim to know whether they booked -------------------------

Deno.test('the closing reads correctly to someone who already booked', () => {
  const m = mail()
  assertStringIncludes(m.text, 'Steht dein Termin schon, ist hier nichts zu tun.')
  assertStringIncludes(m.html, 'Steht dein Termin schon, ist hier nichts zu tun.')
  assertStringIncludes(mail({ language: 'en' }).text, FOLLOWUP_NEUTRAL_CLOSING.en)
})

Deno.test('nothing in the mail asserts a booking state we cannot observe', () => {
  // The calendar is an external URL opened in a new tab. Nothing in this product
  // sees the click, let alone the appointment, and it would take proxying the
  // coach's booking page to change that. So any sentence that presumes an answer
  // is a false statement sent in the coach's name.
  const m = mail({}, { coachNote: 'Bring gern deine Zahlen mit.' })
  for (const body of [m.subject, m.text, m.html]) {
    for (
      const claim of [
        'noch nicht',
        'nicht gebucht',
        'kein Termin',
        'keinen Termin',
        'letzte Chance',
        'immer noch frei',
        'reserviert',
      ]
    ) {
      assert(!body.includes(claim), `the mail claims to know something it cannot: ${claim}`)
    }
  }
  const en = mail({ language: 'en' })
  for (const claim of ['have not booked', "haven't booked", 'still available', 'last chance']) {
    assert(!en.text.includes(claim), `the English mail claims to know something it cannot: ${claim}`)
  }
})

// --- One mail, and the mail says so -----------------------------------------

Deno.test('both bodies say that nothing else follows', () => {
  // This is a promise about our own behaviour, repeated from the consent notice
  // ("eine einzige E-Mail"). What makes it TRUE is not this sentence and not a
  // reviewer's memory: it is the PARTIAL UNIQUE INDEX
  // concierge_followup_outbox_one_sent_per_recipient_idx on
  // (concierge_id, email_normalized) `where status = 'sent'`
  // (20260812100000_concierge_followup_outbox.sql), which turns a second send to
  // the same mailbox into a constraint violation in the database rather than a
  // judgement call in a worker. It is partial on 'sent' so failed and cancelled
  // rows may coexist, and keyed on the mailbox rather than the conversation
  // because one visitor with two tabs is two conversations and one inbox. If
  // that index is ever dropped or widened, this sentence becomes a false
  // statement sent in the coach's name, and this test is where that should stop.
  for (const locale of ['de', 'en'] as const) {
    const m = mail({}, { locale })
    assertStringIncludes(m.text, FOLLOWUP_ONE_MAIL_SENTENCE[locale])
    assertStringIncludes(m.html, FOLLOWUP_ONE_MAIL_SENTENCE[locale])
  }
  assertStringIncludes(FOLLOWUP_ONE_MAIL_SENTENCE.de, 'einzige E-Mail')
  assertStringIncludes(FOLLOWUP_ONE_MAIL_SENTENCE.de, 'Danach kommt nichts mehr.')
  assertStringIncludes(FOLLOWUP_ONE_MAIL_SENTENCE.en, 'Nothing else follows.')
})

// --- The coach's free text ---------------------------------------------------

Deno.test('a URL in the coach note is stripped the way consentMail strips links', () => {
  const m = mail({}, {
    coachNote: 'Schau vorher hier rein: https://coach-meier.example.test/warmup\nBis dann.',
  })
  assert(!m.text.includes('coach-meier.example.test/warmup'))
  assert(!m.html.includes('coach-meier.example.test/warmup'))
  assertStringIncludes(m.text, 'Schau vorher hier rein:')
  assertStringIncludes(m.text, 'Bis dann.')
  // Still three links, not four.
  assertEquals(occurrences(m.text, 'http'), 3)
  assertEquals(occurrences(m.html, 'href='), 3)
})

Deno.test('a link smuggled through the business name or the sender block is stripped', () => {
  const m = mail({
    business_name: 'Coach Meier // jetzt buchen: https://spam.example.test/slot',
    followup_sender_block: 'Coach Meier GmbH\nMehr: www.spam.example.test\nMusterweg 3, 45127 Essen',
  })
  assert(!m.text.includes('spam.example.test'))
  assert(!m.html.includes('spam.example.test'))
  assertStringIncludes(m.text, 'Coach Meier')
  assertStringIncludes(m.text, 'Musterweg 3, 45127 Essen')
  assertEquals(occurrences(m.text, 'http'), 3)
})

Deno.test('the sender block keeps its line structure in both bodies', () => {
  const m = mail()
  assertStringIncludes(m.text, 'Coach Meier GmbH\nMusterweg 3, 45127 Essen')
  assertStringIncludes(m.html, 'Coach Meier GmbH<br>Musterweg 3, 45127 Essen')
})

Deno.test('markup in the business name and in the note is escaped in the html', () => {
  const m = mail({ business_name: 'Meier & <b>Söhne</b>' }, { coachNote: 'Kosten & <i>Ablauf</i>' })
  assert(!m.html.includes('<b>Söhne</b>'))
  assert(!m.html.includes('<i>Ablauf</i>'))
  assertStringIncludes(m.html, 'Meier &amp; &lt;b&gt;Söhne&lt;/b&gt;')
  assertStringIncludes(m.html, 'Kosten &amp; &lt;i&gt;Ablauf&lt;/i&gt;')
  // The plain-text body keeps the characters as typed.
  assertStringIncludes(m.text, 'Meier & <b>Söhne</b>')
})

// --- German house style ------------------------------------------------------

Deno.test('the German mail contains no em dash and no en dash', () => {
  const m = mail({}, { coachNote: 'Bring gern deine Zahlen mit.' })
  for (const body of [m.subject, m.text, m.html]) {
    assert(!body.includes('—'), 'em dash in the German mail')
    assert(!body.includes('–'), 'en dash in the German mail')
  }
})

Deno.test('neither body makes an absolute grounding claim', () => {
  // Standing copy rule: grounding is a prompt instruction, not a guarantee, so
  // "nur aus deinen Inhalten", "erfindet nie" and any talk of Halluzinationen
  // are claims we cannot stand behind in a coach's name. "nur" is banned outright
  // because every form of the claim is built on it.
  for (const locale of ['de', 'en'] as const) {
    const m = mail({}, { locale, coachNote: 'Bring gern deine Zahlen mit.' })
    for (const body of [m.subject, m.text, m.html]) {
      assert(!body.includes('nur'), `"nur" in the ${locale} mail`)
      assert(!body.includes('erfindet nie'), `"erfindet nie" in the ${locale} mail`)
      assert(!body.includes('Halluzin'), `"Halluzin" in the ${locale} mail`)
      assert(!body.includes('halluzin'), `"halluzin" in the ${locale} mail`)
    }
  }
})

Deno.test('the German mail never says "wir": the sender is the coach, named', () => {
  // The From line reads "<Coach> via 2Fronts". A "wir" there has no referent,
  // and §7 Abs. 2 Nr. 4 UWG is about not concealing who is sending. The one
  // sentence 2Fronts says about itself names 2Fronts.
  const m = mail({}, { coachNote: 'Bring gern deine Zahlen mit.' })
  for (const body of [m.subject, m.text, m.html]) {
    assert(!/\bwir\b/i.test(body), 'the German mail says "wir"')
    assert(!/\buns(er|ere|erem|eren|erer|eres)?\b/i.test(body), 'the German mail says "uns"')
  }
  assertStringIncludes(m.text, '2Fronts verschickt diese E-Mail im Auftrag von Coach Meier.')
  // The coach is named, repeatedly, instead.
  assert(occurrences(m.text, 'Coach Meier') >= 4)
})

Deno.test('the German mail uses the du-form', () => {
  const m = mail()
  assertStringIncludes(m.text, 'du hast im Chat')
  assertStringIncludes(m.text, 'falls du ihn brauchst')
  assert(!m.text.includes('Ihre'))
  assert(!m.text.includes('Sie können'))
})

// --- Locale ------------------------------------------------------------------

Deno.test('the consent snapshot locale wins over the row, and lands in html lang', () => {
  const en = mail({ language: 'de' }, { locale: 'en' })
  assertEquals(en.subject, 'The calendar link from Coach Meier')
  assertStringIncludes(en.html, '<html lang="en">')
  assertStringIncludes(en.text, 'you wrote to Coach Meier in the chat.')

  const de = mail({ language: 'en' }, { locale: 'de' })
  assertEquals(de.subject, 'Der Kalenderlink von Coach Meier')
  assertStringIncludes(de.html, '<html lang="de">')
})

Deno.test('the subject names the coach in both locales', () => {
  assertEquals(FOLLOWUP_MAIL_SUBJECT.de('Coach Meier'), 'Der Kalenderlink von Coach Meier')
  assertEquals(FOLLOWUP_MAIL_SUBJECT.en('Coach Meier'), 'The calendar link from Coach Meier')
  assertEquals(mail({ language: 'en' }).subject, 'The calendar link from Coach Meier')
})

// --- Refusals: nothing lawful or useful to send -------------------------------

function refuse(overrides: Partial<FollowupMailConcierge>, rest: Partial<Omit<FollowupMailInput, 'concierge'>> = {}) {
  return buildFollowupMail({
    concierge: { ...CONCIERGE, ...overrides },
    unsubscribeUrl: UNSUBSCRIBE_URL,
    visitorName: 'Anna',
    ...rest,
  })
}

Deno.test('no business name means no mail', () => {
  assertEquals(refuse({ business_name: '   ' }), null)
  // A name that was nothing but a link is also nothing.
  assertEquals(refuse({ business_name: 'https://cal.example.test' }), null)
})

Deno.test('no usable booking link means no mail: the link is the whole point', () => {
  for (const bad of [null, undefined, '', '   ', 'javascript:alert(1)', 'http://evil.test/book', 'cal.example.test']) {
    assertEquals(refuse({ calendar_url: bad }), null, `accepted calendar_url ${bad}`)
  }
  // Loopback over http stays usable for local runs.
  assert(refuse({ calendar_url: 'http://localhost:54321/cal' }))
})

Deno.test('no privacy URL means no mail: the coach is the controller, Art. 13 DSGVO', () => {
  for (const bad of [null, undefined, '', 'http://coach-meier.example.test/datenschutz', 'not a url']) {
    assertEquals(refuse({ followup_privacy_url: bad }), null, `accepted privacy url ${bad}`)
  }
})

Deno.test('no unsubscribe URL means no mail: §7 Abs. 2 Nr. 4 UWG', () => {
  for (const bad of ['', '   ', 'not a url', 'javascript:alert(1)', 'https://ok.test/u?x="onmouseover=1']) {
    assertEquals(refuse({}, { unsubscribeUrl: bad }), null, `accepted unsubscribe url ${bad}`)
  }
})

Deno.test('a URL that could break out of an href is refused rather than escaped away', () => {
  assertEquals(refuse({ calendar_url: 'https://cal.example.test/a b' }), null)
  assertEquals(refuse({ calendar_url: 'https://cal.example.test/<script>' }), null)
  assertEquals(refuse({ calendar_url: 'https://cal.example.test/"onload=x' }), null)
})
