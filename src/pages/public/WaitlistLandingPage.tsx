import { useTranslation } from 'react-i18next'

// Stub. Sprint B fills in the public waitlist landing + capture backend.
export function WaitlistLandingPage() {
  const { t } = useTranslation()
  return (
    <div className="page-stack">
      <h1>{t('waitlist.title')}</h1>
      <p>{t('waitlist.comingSoon')}</p>
    </div>
  )
}
