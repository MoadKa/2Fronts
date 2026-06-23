import { useTranslation } from 'react-i18next'

// Stub. Sprint B fills in the public /app homepage (for Google OAuth review).
export function AppHomePage() {
  const { t } = useTranslation()
  return (
    <div className="page-stack">
      <h1>{t('appHome.title')}</h1>
      <p>{t('appHome.comingSoon')}</p>
    </div>
  )
}
