import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { useDocumentMeta } from '../../hooks/useDocumentMeta'

export function NotFoundPage() {
  const { t } = useTranslation()

  // The SPA answers every unknown path with HTTP 200, so without this a typo'd
  // or retired URL is a soft 404: indexable, and titled after whichever route
  // the visitor happened to come from. The legal routes already set noindex;
  // this one was the gap.
  useDocumentMeta({ title: `${t('notFound.title')} — 2Fronts`, noindex: true })

  return (
    <div className="empty-state">
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.body')}</p>
      <Link to="/automations"><Button variant="secondary">{t('notFound.backToCatalog')}</Button></Link>
    </div>
  )
}
