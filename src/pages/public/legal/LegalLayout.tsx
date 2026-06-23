import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// Shared scaffold for the three legal pages (Impressum, Datenschutz, AGB).
// Renders the title, an optional DRAFT banner, the "last updated" line and the
// page body. All visible strings come from the `legal.*` i18n namespace.
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
  return (
    <div className="page-stack">
      <div className="page-header">
        <h1>{title}</h1>
        {draft && (
          <p role="note" style={{ fontWeight: 600 }}>
            {t('legal.draftNotice')}
          </p>
        )}
        <p>
          {t('legal.lastUpdatedLabel')}: {t('legal.lastUpdated')}
        </p>
      </div>
      {children}
    </div>
  )
}

// A single titled section: a heading plus one or more paragraphs. `body` may
// contain newlines (e.g. a postal address); they are preserved via pre-line.
export function LegalSection({ heading, body }: { heading: string; body: string }) {
  return (
    <section>
      <h2>{heading}</h2>
      <p style={{ whiteSpace: 'pre-line' }}>{body}</p>
    </section>
  )
}
