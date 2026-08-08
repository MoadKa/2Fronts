// The two pages a visitor can land on after clicking the link in the
// double-opt-in mail: "confirmed" and the neutral page.
//
// WHY THIS IS ITS OWN MODULE:
// The confirm endpoint must never throw and must answer identically for an
// unknown and an expired token. Keeping the markup here, as pure string
// builders with no I/O, means the endpoint's control flow is only ever "pick a
// page and return it", and a test can compare two neutral responses byte for
// byte.
//
// HARD RULES FOR EVERYTHING IN HERE:
//
//   - NO EXTERNAL HOST OF ANY KIND. No font, no stylesheet, no image, no
//     script, no favicon, no analytics. This page is reached from a mail
//     client; every outbound request it makes would hand a third party the
//     visitor's IP and the referring URL, and that URL carries the confirm
//     token. The Content-Security-Policy below is `default-src 'none'`, which
//     makes the rule enforceable rather than merely intended, and a test greps
//     the markup for `http` so a future edit cannot quietly add one.
//
//   - NOINDEX TWICE. A header (`X-Robots-Tag`) and a meta tag. The header
//     covers the case where a crawler never parses the body; the meta covers a
//     proxy that strips unknown headers. A search engine that indexed a
//     confirm URL would publish a live consent token.
//
//   - NO REFERRER. `Referrer-Policy: no-referrer` plus the meta equivalent.
//     There is no outbound link on the page today, and this keeps it true if
//     one is ever added by accident.
//
// The visual world is DESIGN.md ("Der Rundgang"): linen plaster ground, one
// raised pane with a hairline edge, zero radius, no shadow, warm neutrals only,
// the two faces (Familjen Grotesk for the heading, Archivo for prose) declared
// as a family stack WITHOUT a webfont, because loading one would need an
// external host. Work-surface heading step (--op-h1: 1.75rem), not the
// exhibition's fluid clamp: this is a single statement read at desk distance.

import type { ConsentLocale } from './consent.ts'

// Header set applied to every response the confirm endpoint returns. Deliberately
// identical for the confirmed and the neutral page, so headers cannot become the
// side channel the page bodies were careful not to be.
export const CONSENT_PAGE_CSP = [
  "default-src 'none'",
  // The only relaxation, and only because the page's styling is a <style>
  // element. There is no script anywhere on the page, and script-src stays
  // 'none', so an inline style cannot be turned into execution.
  "style-src 'unsafe-inline'",
  "script-src 'none'",
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ')

export function consentPageHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': CONSENT_PAGE_CSP,
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // The request URL carries a live confirm token. A shared cache holding this
    // response would hold that token; a back-button replay would re-show a page
    // whose underlying state may have changed.
    'Cache-Control': 'no-store, max-age=0',
  }
}

export function consentPageResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: consentPageHeaders() })
}

// --------------------------------------------------------------------------
// Escaping
// --------------------------------------------------------------------------

// Text-node escaping. The only interpolated value on these pages is the
// business name, which a coach types into the setup wizard — untrusted by the
// same standard as any other user input.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Attribute escaping. Adds the quote characters on top of the text set, so a
// value is safe inside either a double- or single-quoted attribute.
export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// --------------------------------------------------------------------------
// Wording
// --------------------------------------------------------------------------

interface PageCopy {
  title: string
  heading: string
  paragraphs: string[]
}

const CONFIRMED: Record<ConsentLocale, (businessName: string) => PageCopy> = {
  de: (b) => ({
    title: 'E-Mail-Adresse bestätigt',
    heading: 'Danke, deine E-Mail-Adresse ist bestätigt.',
    paragraphs: [
      `${b} darf dir jetzt zu eurem Gespräch schreiben. Es geht um dieses eine Gespräch und um eine einzige E-Mail.`,
      'Du kannst das jederzeit widerrufen. Unten in jeder E-Mail steht ein Link dafür.',
      'Du kannst dieses Fenster jetzt schließen.',
    ],
  }),
  en: (b) => ({
    title: 'Email address confirmed',
    heading: 'Thank you, your email address is confirmed.',
    paragraphs: [
      `${b} may now write to you about your conversation. It covers this one conversation and a single email.`,
      'You can withdraw at any time. Every email carries a link for that at the bottom.',
      'You can close this window now.',
    ],
  }),
}

// THE NEUTRAL PAGE.
//
// One page for every failure: a token we never issued, a token that ran out, a
// truncated token, a database that would not answer. It names none of them.
// Saying "expired" would confirm to a stranger that the token was once real,
// and "unknown" would confirm that it never was; between those two answers
// sits an oracle that tells anyone poking the endpoint which of their guesses
// hit a live consent. So the page says only that the link did not work, offers
// a route that does not depend on the token, and stops.
const NEUTRAL: Record<ConsentLocale, PageCopy> = {
  de: {
    title: 'Link lässt sich nicht öffnen',
    heading: 'Mit diesem Link können wir nichts anfangen.',
    paragraphs: [
      'Vielleicht hat dein Mail-Programm ihn beim Anzeigen zerschnitten. Kopiere die ganze Adresse aus der E-Mail und öffne sie noch einmal.',
      'Du musst jetzt nichts weiter tun. Es wird dir nichts geschickt.',
      'Willst du deine E-Mail-Adresse doch bestätigen, dann schreib noch einmal auf der Seite, über die ihr euch geschrieben habt.',
    ],
  },
  en: {
    title: 'This link did not work',
    heading: 'We cannot do anything with this link.',
    paragraphs: [
      'Your mail programme may have cut it in half while displaying it. Copy the whole address out of the email and open it again.',
      'You do not have to do anything now. Nothing will be sent to you.',
      'If you still want to confirm your email address, write again on the page where the two of you talked.',
    ],
  },
}

// --------------------------------------------------------------------------
// Markup
// --------------------------------------------------------------------------

// Der Rundgang, as literals. The page cannot reach src/index.css (it is served
// by an edge function, not by the SPA), so the tokens are inlined here with the
// names they carry in DESIGN.md. Values, not guesses: plaster / plaster-2 /
// plaster-line / ink / ink-2, zero radius, no shadow, hairline edges.
const STYLE = `
  :root {
    --plaster: #e7dfd0;
    --plaster-2: #f3ede1;
    --plaster-line: #cec2ad;
    --ink: #17130f;
    --ink-2: #56503f;
    --crimson-deep: #5a171c;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--plaster);
    color: var(--ink);
    font-family: Archivo, "Segoe UI", system-ui, sans-serif;
    font-size: 1.08rem;
    line-height: 1.6;
    -webkit-text-size-adjust: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: clamp(1.25rem, 4vw, 4rem);
  }
  main {
    background: var(--plaster-2);
    border: 1px solid var(--plaster-line);
    border-radius: 0;
    box-shadow: none;
    padding: clamp(1.5rem, 3vw, 2.5rem);
    max-width: 34rem;
    width: 100%;
  }
  h1 {
    font-family: "Familjen Grotesk", "Segoe UI", system-ui, sans-serif;
    font-size: 1.75rem;
    font-weight: 700;
    line-height: 1.04;
    letter-spacing: -0.03em;
    margin: 0 0 1.25rem;
    max-width: 26ch;
  }
  p {
    margin: 0 0 0.9rem;
    max-width: 62ch;
    color: var(--ink-2);
  }
  p:first-of-type { color: var(--ink); }
  p:last-child { margin-bottom: 0; }
  :focus-visible {
    outline: 3px solid var(--crimson-deep);
    outline-offset: 3px;
    border-radius: 0;
  }
`

function page(locale: ConsentLocale, copy: PageCopy): string {
  const body = copy.paragraphs.map((t) => `    <p>${escapeHtml(t)}</p>`).join('\n')
  return `<!doctype html>
<html lang="${escapeAttr(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(copy.title)}</title>
<style>${STYLE}</style>
</head>
<body>
  <main>
    <h1>${escapeHtml(copy.heading)}</h1>
${body}
  </main>
</body>
</html>
`
}

export function renderConfirmedPage(locale: ConsentLocale, businessName: string): string {
  return page(locale, CONFIRMED[locale](businessName.trim()))
}

// Takes only a locale on purpose: there is nothing else it is allowed to know.
// If this function ever grows a second argument, the neutral page has started
// carrying information about the token, and that is the leak.
export function renderNeutralPage(locale: ConsentLocale): string {
  return page(locale, NEUTRAL[locale])
}

// Pick a page language when we have no concierge to ask, i.e. on every neutral
// page. Reads Accept-Language only, which costs nothing and reveals nothing:
// the visitor's own browser told us, and no row was touched to find out.
// German is the default because the product is sold in German.
export function localeFromAcceptLanguage(header: string | null): ConsentLocale {
  if (!header) return 'de'
  for (const part of header.split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase()
    if (tag.startsWith('de')) return 'de'
    if (tag.startsWith('en')) return 'en'
  }
  return 'de'
}

// Clamp whatever the concierge row holds to a language we actually render.
export function clampLocale(value: unknown): ConsentLocale {
  return value === 'en' ? 'en' : 'de'
}
