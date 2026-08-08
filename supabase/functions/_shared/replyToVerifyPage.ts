// The two pages a COACH can land on after clicking the link in the reply-to
// verification mail: "confirmed" and the neutral page.
//
// Third sibling of consentPage.ts and followupPage.ts, built on the first one's
// style and escaping, so every page reachable out of a 2Fronts mail looks like
// the same building. It repeats that module's hard rules rather than relaxing
// any of them:
//
//   - NO EXTERNAL HOST OF ANY KIND. No font, no stylesheet, no image, no
//     script, no favicon, no analytics. The URL that got the coach here carries
//     a live verification token; every outbound request the page made would
//     hand that URL to a third party in a Referer header. The CSP is
//     `default-src 'none'` and a test greps the markup for `http`.
//
//   - NOINDEX TWICE, header and meta. An indexed verification URL is a live
//     token published on a search results page.
//
//   - NO REFERRER, header and meta.
//
// There is no form and no second click: this page is reached by the click, and
// by the time it renders the column is already stamped. It reuses
// consentPageResponse's header set unchanged (see consentPage.ts) rather than
// minting a fourth one, because these two pages need exactly the same
// guarantees and a second copy would be a second thing to keep in step.

import type { ConsentLocale } from './consent.ts'
import { escapeAttr, escapeHtml, PAGE_STYLE } from './consentPage.ts'

interface PageCopy {
  title: string
  heading: string
  paragraphs: string[]
}

const VERIFIED: Record<ConsentLocale, (businessName: string) => PageCopy> = {
  de: (b) => ({
    title: 'Antwortadresse bestätigt',
    heading: 'Danke, deine Antwortadresse ist bestätigt.',
    paragraphs: [
      `Antworten auf die Nachfass-E-Mails von ${b} gehen ab jetzt an dieses Postfach.`,
      'Änderst du die Adresse später im Setup, musst du sie noch einmal bestätigen. Wir schicken dir dann eine neue E-Mail.',
      'Du kannst dieses Fenster jetzt schließen.',
    ],
  }),
  en: (b) => ({
    title: 'Reply-to address confirmed',
    heading: 'Thank you, your reply-to address is confirmed.',
    paragraphs: [
      `Replies to the follow-up emails from ${b} now go to this mailbox.`,
      'If you change the address in the setup later, you have to confirm it again. We will send you a new email then.',
      'You can close this window now.',
    ],
  }),
}

// THE NEUTRAL PAGE.
//
// One page for every failure: a token we never issued, a truncated one, a
// concierge we cannot resolve, an address that has changed since the mail went
// out, a database that would not answer. It names none of them, for the reason
// consentPage.ts's neutral page names none: between "unknown" and "stale" sits
// an oracle telling anyone poking the endpoint which of their guesses hit a
// real setter.
//
// The second paragraph is not an exception to that. It is offered on EVERY
// failure, so it distinguishes nothing; it is there because "you changed the
// address" is by far the most likely reason a coach is looking at this page,
// and leaving them without that sentence turns a self-inflicted, one-click
// problem into a support ticket.
const NEUTRAL: Record<ConsentLocale, PageCopy> = {
  de: {
    title: 'Link lässt sich nicht öffnen',
    heading: 'Mit diesem Link können wir nichts anfangen.',
    paragraphs: [
      'Vielleicht hat dein Mail-Programm ihn beim Anzeigen zerschnitten. Kopiere die ganze Adresse aus der E-Mail und öffne sie noch einmal.',
      'Vielleicht hast du die Antwortadresse seitdem auch geändert. Dann zählt nur der Link aus der neuesten E-Mail.',
      'Bestätigt ist nichts. Trag die Adresse im Setup noch einmal ein, dann schicken wir dir einen neuen Link.',
    ],
  },
  en: {
    title: 'This link did not work',
    heading: 'We cannot do anything with this link.',
    paragraphs: [
      'Your mail programme may have cut it in half while displaying it. Copy the whole address out of the email and open it again.',
      'You may also have changed the reply-to address since then. Only the link from the newest email counts.',
      'Nothing is confirmed. Enter the address in the setup again and we will send you a new link.',
    ],
  },
}

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
<style>${PAGE_STYLE}</style>
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

export function renderReplyToVerifiedPage(locale: ConsentLocale, businessName: string): string {
  return page(locale, VERIFIED[locale](businessName.trim()))
}

// Takes only a locale, on purpose. A second argument would mean the neutral
// page had started carrying information about the token, and that is the leak.
export function renderReplyToVerifyNeutralPage(locale: ConsentLocale): string {
  return page(locale, NEUTRAL[locale])
}
