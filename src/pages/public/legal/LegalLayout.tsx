import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocumentMeta } from '../../../hooks/useDocumentMeta'
import './LegalLayout.css'

// Shared scaffold for the three legal pages (Impressum, Datenschutz, AGB).
// Renders the title, an optional DRAFT banner, the "last updated" line and the
// page body. All visible strings come from the `legal.*` i18n namespace.
//
// noindex: these pages exist for legal compliance, not to rank — without this
// they'd otherwise dilute the site's title/meta signal since the app has no
// per-route <title> by default (see seo-audit-2026-07-08.md finding #3).
export function LegalLayout({
  title,
  draft = false,
  children,
}: {
  title: string
  draft?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  useDocumentMeta({ title: `${title} — 2Fronts`, noindex: true })
  return (
    <article className="legal-page page-stack">
      <header className="legal-header">
        <h1>{title}</h1>
        {draft && (
          <p className="legal-draft" role="note">
            {t('legal.draftNotice')}
          </p>
        )}
        <p className="legal-updated">
          {t('legal.lastUpdatedLabel')}: {t('legal.lastUpdated')}
        </p>
      </header>
      <div className="legal-body">{children}</div>
    </article>
  )
}

// A single titled section: a heading plus one or more paragraphs. `body` may
// contain newlines (e.g. a postal address); they are preserved via pre-line.
export function LegalSection({ heading, body }: { heading: string; body: string }) {
  return (
    <section className="legal-section">
      <h2>{heading}</h2>
      <p style={{ whiteSpace: 'pre-line' }}>{body}</p>
    </section>
  )
}
