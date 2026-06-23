import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="empty-state">
      <h2>{t('notFound.title')}</h2>
      <p>{t('notFound.body')}</p>
      <Link to="/automations"><Button variant="secondary">{t('notFound.backToCatalog')}</Button></Link>
    </div>
  )
}
