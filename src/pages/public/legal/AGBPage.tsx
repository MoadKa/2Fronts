import { useTranslation } from 'react-i18next'

// Stub. Sprint A fills in the B2B terms without touching App.tsx.
export function AGBPage() {
  const { t } = useTranslation()
  return (
    <div className="page-stack">
      <h1>{t('legal.agbTitle')}</h1>
      <p>{t('legal.comingSoon')}</p>
    </div>
  )
}
