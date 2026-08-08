import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  CONSENT_PAGE_CSP,
  clampLocale,
  consentPageHeaders,
  consentPageResponse,
  escapeAttr,
  escapeHtml,
  localeFromAcceptLanguage,
  renderConfirmedPage,
  renderNeutralPage,
} from './consentPage.ts'

const ALL_PAGES = [
  renderConfirmedPage('de', 'Coach Meier'),
  renderConfirmedPage('en', 'Coach Meier'),
  renderNeutralPage('de'),
  renderNeutralPage('en'),
]

// --- No external host, at all ----------------------------------------------

Deno.test('no page references an external host in any form', () => {
  for (const html of ALL_PAGES) {
    assert(!html.includes('http://'), 'an http URL reached the page')
    assert(!html.includes('https://'), 'an https URL reached the page')
    assert(!/\ssrc=/.test(html), 'a src attribute reached the page')
    assert(!html.includes('@import'), 'an @import reached the page')
    assert(!html.includes('url('), 'a css url() reached the page')
    assert(!html.includes('<script'), 'a script element reached the page')
    assert(!html.includes('<link'), 'a link element reached the page')
    assert(!html.includes('<img'), 'an img element reached the page')
    assert(!html.includes('@font-face'), 'a webfont reached the page')
  }
})

Deno.test('the CSP forbids everything and then re-allows only inline style', () => {
  assertStringIncludes(CONSENT_PAGE_CSP, "default-src 'none'")
  assertStringIncludes(CONSENT_PAGE_CSP, "script-src 'none'")
  assertStringIncludes(CONSENT_PAGE_CSP, "img-src 'none'")
  assertStringIncludes(CONSENT_PAGE_CSP, "font-src 'none'")
  assertStringIncludes(CONSENT_PAGE_CSP, "connect-src 'none'")
  assertStringIncludes(CONSENT_PAGE_CSP, "frame-ancestors 'none'")
  assertStringIncludes(CONSENT_PAGE_CSP, "base-uri 'none'")
  // The single relaxation, and only for style.
  assertEquals(CONSENT_PAGE_CSP.includes("style-src 'unsafe-inline'"), true)
  assert(!CONSENT_PAGE_CSP.includes("script-src 'unsafe-inline'"))
})

// --- noindex, twice ---------------------------------------------------------

Deno.test('every page carries the robots meta and every response the header', () => {
  for (const html of ALL_PAGES) {
    assertStringIncludes(html, '<meta name="robots" content="noindex, nofollow">')
    assertStringIncludes(html, '<meta name="referrer" content="no-referrer">')
  }
  const headers = consentPageHeaders()
  assertEquals(headers['X-Robots-Tag'], 'noindex, nofollow')
  assertEquals(headers['Referrer-Policy'], 'no-referrer')
  assertEquals(headers['X-Content-Type-Options'], 'nosniff')
  assertEquals(headers['Content-Security-Policy'], CONSENT_PAGE_CSP)
  assertStringIncludes(headers['Cache-Control'], 'no-store')
  assertStringIncludes(headers['Content-Type'], 'text/html')
})

Deno.test('consentPageResponse applies the headers and the given status', async () => {
  const res = consentPageResponse(renderNeutralPage('de'), 405)
  assertEquals(res.status, 405)
  assertEquals(res.headers.get('X-Robots-Tag'), 'noindex, nofollow')
  assertEquals(res.headers.get('Content-Security-Policy'), CONSENT_PAGE_CSP)
  assertStringIncludes(await res.text(), '<html lang="de">')
})

// --- Language ---------------------------------------------------------------

Deno.test('html lang comes from the locale, not from a default', () => {
  assertStringIncludes(renderConfirmedPage('de', 'X'), '<html lang="de">')
  assertStringIncludes(renderConfirmedPage('en', 'X'), '<html lang="en">')
  assertStringIncludes(renderNeutralPage('en'), '<html lang="en">')
})

Deno.test('Accept-Language picks the neutral page language, defaulting to de', () => {
  assertEquals(localeFromAcceptLanguage(null), 'de')
  assertEquals(localeFromAcceptLanguage(''), 'de')
  assertEquals(localeFromAcceptLanguage('en-GB,en;q=0.9'), 'en')
  assertEquals(localeFromAcceptLanguage('de-DE,de;q=0.9,en;q=0.8'), 'de')
  assertEquals(localeFromAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8'), 'en')
  assertEquals(localeFromAcceptLanguage('ja'), 'de')
})

Deno.test('clampLocale only ever answers de or en', () => {
  assertEquals(clampLocale('en'), 'en')
  assertEquals(clampLocale('de'), 'de')
  assertEquals(clampLocale('fr'), 'de')
  assertEquals(clampLocale(null), 'de')
  assertEquals(clampLocale(undefined), 'de')
  assertEquals(clampLocale(42), 'de')
})

// --- The neutral page tells nobody anything ---------------------------------

Deno.test('the neutral page names no cause, so unknown and expired are indistinguishable', () => {
  for (const locale of ['de', 'en'] as const) {
    const html = renderNeutralPage(locale).toLowerCase()
    for (
      const forbidden of [
        'abgelaufen',
        'expired',
        'ungültig',
        'ungueltig',
        'invalid',
        'unbekannt',
        'unknown',
        'nicht gefunden',
        'not found',
        'bereits',
        'already',
      ]
    ) {
      assert(!html.includes(forbidden), `the neutral page leaked a cause: ${forbidden}`)
    }
  }
})

Deno.test('the neutral page is a pure function of the locale (byte-identical on every call)', () => {
  assertEquals(renderNeutralPage('de'), renderNeutralPage('de'))
  assertEquals(renderNeutralPage('en'), renderNeutralPage('en'))
})

Deno.test('the neutral page states that nothing will be sent', () => {
  assertStringIncludes(renderNeutralPage('de'), 'Es wird dir nichts geschickt.')
  assertStringIncludes(renderNeutralPage('en'), 'Nothing will be sent to you.')
})

// --- The confirmed page -----------------------------------------------------

Deno.test('the confirmed page names the sender and the withdrawal route', () => {
  const de = renderConfirmedPage('de', 'Coach Meier')
  assertStringIncludes(de, 'Coach Meier')
  assertStringIncludes(de, 'bestätigt')
  assertStringIncludes(de, 'widerrufen')

  const en = renderConfirmedPage('en', 'Coach Meier')
  assertStringIncludes(en, 'Coach Meier')
  assertStringIncludes(en, 'withdraw')
})

Deno.test('a business name is escaped, never injected', () => {
  const html = renderConfirmedPage('de', '<script>alert(1)</script> & Söhne')
  assert(!html.includes('<script>alert(1)</script>'))
  assertStringIncludes(html, '&lt;script&gt;alert(1)&lt;/script&gt; &amp; Söhne')
})

// --- House style ------------------------------------------------------------

Deno.test('no page contains an em dash or an en dash', () => {
  for (const html of ALL_PAGES) {
    assert(!html.includes('—'), 'em dash on a visitor-facing page')
    assert(!html.includes('–'), 'en dash on a visitor-facing page')
  }
})

// --- Escaping ---------------------------------------------------------------

Deno.test('escapeHtml and escapeAttr cover their contexts', () => {
  assertEquals(escapeHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d')
  // The text escaper deliberately leaves quotes alone; the attribute one must not.
  assertEquals(escapeHtml('"x"'), '"x"')
  assertEquals(escapeAttr(`"x" 'y' & z`), '&quot;x&quot; &#39;y&#39; &amp; z')
})
