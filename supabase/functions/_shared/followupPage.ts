// The three pages a recipient can land on after clicking "abmelden" at the
// bottom of a follow-up mail: "you are unsubscribed", "your unsubscribe is
// undone", and the neutral page.
//
// Sibling of consentPage.ts and built on its style and its escaping, so both
// pages reached out of the same mail look like the same building. It repeats
// that module's hard rules rather than relaxing any of them:
//
//   - NO EXTERNAL HOST OF ANY KIND. No font, no stylesheet, no image, no
//     script, no favicon, no analytics. The URL that got the visitor here
//     carries a token that is a standing authority to suppress mail for their
//     address; every outbound request the page made would hand that URL to a
//     third party in a Referer header. A test greps the markup for `http`.
//
//   - NOINDEX TWICE, header and meta. An indexed unsubscribe URL is a live
//     withdrawal token published on a search results page.
//
//   - NO REFERRER, header and meta.
//
// THE ONE DIFFERENCE FROM consentPage.ts's POSTURE: this CSP allows
// `form-action 'self'`, because the "undo" control is a real form that POSTs
// back to this same endpoint. It cannot be a link. A GET undo would be followed
// by the same mail-client prefetchers that we deliberately let trigger the
// unsubscribe, and the misfire direction would flip from "no mail is sent" to
// "mail we were told to stop sending starts again". So undo is POST-only and
// the page needs a form; `'self'` is the narrowest grant that allows one.
//
// The confirmation pages are deliberately WORDED AS DONE, past tense, no
// "click here to complete". By the time any of these render, the suppression is
// already written. A page that asks for a second click is a page that leaves
// people unsubscribed only if they read to the end.

import type { ConsentLocale } from './consent.ts'
import { escapeAttr, escapeHtml, PAGE_STYLE } from './consentPage.ts'

// The undo control is the only interactive element on any of these pages.
const BUTTON_STYLE = `
  form { margin: 1.5rem 0 0; }
  button {
    background: var(--plaster);
    border: 1px solid var(--plaster-line);
    border-radius: 0;
    box-shadow: none;
    color: var(--ink);
    cursor: pointer;
    font-family: "Familjen Grotesk", "Segoe UI", system-ui, sans-serif;
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    padding: 0.75rem 1.4rem;
  }
  button:hover { background: var(--plaster-2); }
`

export const FOLLOWUP_PAGE_CSP = [
  "default-src 'none'",
  // The single relaxation inherited from consentPage.ts: the styling is a
  // <style> element. script-src stays 'none', so an inline style cannot become
  // execution.
  "style-src 'unsafe-inline'",
  "script-src 'none'",
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  // The undo form, and nothing else. See the module header.
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ')

export function followupPageHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': FOLLOWUP_PAGE_CSP,
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // The request URL carries a live withdrawal token, and this response says
    // out loud whether that token resolved. Neither belongs in a shared cache.
    'Cache-Control': 'no-store, max-age=0',
  }
}

/**
 * `head` exists because a HEAD request must carry the headers and no body, and
 * this endpoint answers HEAD (see the endpoint's method comment).
 */
export function followupPageResponse(html: string, status = 200, head = false): Response {
  return new Response(head ? null : html, { status, headers: followupPageHeaders() })
}

// --------------------------------------------------------------------------
// Wording. German house style: du-form, short sentences, no em dash, no en
// dash, no marketing vocabulary.
// --------------------------------------------------------------------------

interface PageCopy {
  title: string
  heading: string
  paragraphs: string[]
  /** Rendered as the undo form's submit button when an action URL is given. */
  undoLabel?: string
}

const UNSUBSCRIBED: Record<ConsentLocale, (businessName: string) => PageCopy> = {
  de: (b) => ({
    title: 'Abgemeldet',
    heading: `Du bekommst keine E-Mail mehr von ${b}.`,
    paragraphs: [
      'Das ist sofort eingetragen. Es geht nichts mehr an deine Adresse raus.',
      'Du musst jetzt nichts weiter tun. Dieses Fenster kannst du schließen.',
      'War das ein Versehen, zum Beispiel weil dein Mail-Programm den Link von allein geöffnet hat, dann kannst du es hier zurücknehmen.',
    ],
    undoLabel: 'Abmeldung zurücknehmen',
  }),
  en: (b) => ({
    title: 'Unsubscribed',
    heading: `You will not get any more email from ${b}.`,
    paragraphs: [
      'This took effect straight away. Nothing further goes to your address.',
      'You do not have to do anything now. You can close this window.',
      'If this was a mistake, for example because your mail programme opened the link on its own, you can take it back here.',
    ],
    undoLabel: 'Undo the unsubscribe',
  }),
}

const UNDONE: Record<ConsentLocale, (businessName: string) => PageCopy> = {
  de: (b) => ({
    title: 'Abmeldung zurückgenommen',
    heading: 'Deine Abmeldung ist zurückgenommen.',
    paragraphs: [
      `${b} darf dir zu eurem Gespräch wieder schreiben. Es bleibt bei diesem einen Gespräch und einer einzigen E-Mail.`,
      'Willst du dich doch abmelden, öffne den Link aus der E-Mail noch einmal.',
    ],
  }),
  en: (b) => ({
    title: 'Unsubscribe undone',
    heading: 'Your unsubscribe has been taken back.',
    paragraphs: [
      `${b} may write to you about your conversation again. It stays with that one conversation and a single email.`,
      'If you do want to unsubscribe after all, open the link from the email again.',
    ],
  }),
}

// THE NEUTRAL PAGE.
//
// One page for every failure: a token we never issued, a truncated one, a
// conversation we cannot resolve, a database that would not answer. It names
// none of them, for the same reason consentPage.ts's neutral page names none:
// between "unknown" and "expired" sits an oracle telling anyone poking the
// endpoint which of their guesses hit a real conversation.
//
// It carries one thing that page does not: A ROUTE THAT DOES NOT NEED US. When
// this page renders, NOTHING WAS SUPPRESSED. Someone standing in front of it is
// a person who tried to withdraw and did not manage to, and leaving them with
// only "sorry" would be the §7 failure with extra steps. Replying to the mail
// reaches the coach's verified reply-to and obliges them directly.
const NEUTRAL: Record<ConsentLocale, PageCopy> = {
  de: {
    title: 'Link lässt sich nicht öffnen',
    heading: 'Mit diesem Link können wir nichts anfangen.',
    paragraphs: [
      'Vielleicht hat dein Mail-Programm ihn beim Anzeigen zerschnitten. Kopiere die ganze Adresse aus der E-Mail und öffne sie noch einmal.',
      'Wichtig: Du bist damit noch nicht abgemeldet.',
      'Es geht auch ohne diesen Link. Antworte einfach auf die E-Mail und schreib, dass du keine weitere bekommen willst. Das reicht.',
    ],
  },
  en: {
    title: 'This link did not work',
    heading: 'We cannot do anything with this link.',
    paragraphs: [
      'Your mail programme may have cut it in half while displaying it. Copy the whole address out of the email and open it again.',
      'Important: this means you are not unsubscribed yet.',
      'There is a way without this link. Just reply to the email and say you do not want another one. That is enough.',
    ],
  },
}

// --------------------------------------------------------------------------
// Markup
// --------------------------------------------------------------------------

function page(locale: ConsentLocale, copy: PageCopy, undoAction?: string): string {
  const body = copy.paragraphs.map((t) => `    <p>${escapeHtml(t)}</p>`).join('\n')
  // The action is built by the endpoint from its OWN request path, never from
  // anything a caller supplied, and `form-action 'self'` refuses it if that
  // ever stops being true.
  const form = undoAction && copy.undoLabel
    ? `\n    <form method="post" action="${escapeAttr(undoAction)}">
      <button type="submit">${escapeHtml(copy.undoLabel)}</button>
    </form>`
    : ''
  return `<!doctype html>
<html lang="${escapeAttr(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(copy.title)}</title>
<style>${PAGE_STYLE}${BUTTON_STYLE}</style>
</head>
<body>
  <main>
    <h1>${escapeHtml(copy.heading)}</h1>
${body}${form}
  </main>
</body>
</html>
`
}

/**
 * `undoAction` is a path-and-query on this same endpoint. Omitted, the page
 * renders without the undo form, which is what a One-Click POST from a mail
 * provider gets: no human is looking at that response.
 */
export function renderUnsubscribedPage(
  locale: ConsentLocale,
  businessName: string,
  undoAction?: string,
): string {
  return page(locale, UNSUBSCRIBED[locale](businessName.trim()), undoAction)
}

export function renderUnsubscribeUndonePage(locale: ConsentLocale, businessName: string): string {
  return page(locale, UNDONE[locale](businessName.trim()))
}

// Takes only a locale, on purpose. A second argument would mean the neutral
// page had started carrying information about the token, and that is the leak.
export function renderUnsubscribeNeutralPage(locale: ConsentLocale): string {
  return page(locale, NEUTRAL[locale])
}
