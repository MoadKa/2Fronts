import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import './ConciergeEmbedSection.css'

// "Auf deiner Website einbauen": the self-serve install tutorial for the
// chat-bubble widget (public/embed.js). Shown on the wizard's done screen and
// on the coach's dashboard. One line of HTML with the coach's REAL slug, a
// copy button, three plain steps, and collapsible per-builder hints.

const PLATFORMS = ['wordpress', 'wix', 'squarespace', 'webflow', 'jimdo'] as const

// The snippet points at the origin serving this app, so preview/staging
// deployments produce a snippet that loads their own embed.js. In production
// that's https://2fronts.de/embed.js. (Not exported: this file must only
// export the component for react-refresh; the test rebuilds the string.)
function embedSnippet(slug: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://2fronts.de'
  return `<script src="${origin}/embed.js" data-concierge="${slug}" async></script>`
}

export function ConciergeEmbedSection({ slugs }: { slugs: string[] }) {
  const { t } = useTranslation()
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)

  const copy = (slug: string) => {
    // Only claim success once the write actually resolves — clipboard access
    // can be unavailable (insecure context, older browser) or rejected
    // (permission denied), and the coach must not be told it worked when it didn't.
    const write = navigator.clipboard?.writeText(embedSnippet(slug))
    if (!write) return
    write.then(() => setCopiedSlug(slug)).catch(() => {})
  }

  return (
    <section className="concierge-embed rise">
      <h2>{t('conciergeEmbed.title')}</h2>
      <p className="concierge-embed-intro">{t('conciergeEmbed.intro')}</p>

      {slugs.map((slug) => (
        <div key={slug} className="concierge-embed-snippet">
          <code className="concierge-embed-code" aria-label={t('conciergeEmbed.snippetLabel')}>
            {embedSnippet(slug)}
          </code>
          <button type="button" className="concierge-embed-copy" onClick={() => copy(slug)}>
            {copiedSlug === slug ? t('conciergeEmbed.copied') : t('conciergeEmbed.copy')}
          </button>
        </div>
      ))}

      <ol className="concierge-embed-steps">
        <li>{t('conciergeEmbed.step1')}</li>
        <li>{t('conciergeEmbed.step2')}</li>
        <li>{t('conciergeEmbed.step3')}</li>
      </ol>

      <div className="concierge-embed-platforms">
        <span className="concierge-embed-platforms-label">
          {t('conciergeEmbed.platformsLabel')}
        </span>
        {PLATFORMS.map((p) => (
          <details key={p} className="concierge-embed-platform">
            <summary>{t(`conciergeEmbed.platforms.${p}.name`)}</summary>
            <p>{t(`conciergeEmbed.platforms.${p}.hint`)}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
