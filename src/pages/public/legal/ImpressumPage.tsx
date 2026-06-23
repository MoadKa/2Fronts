import { useTranslation } from 'react-i18next'

// Stub. Sprint A fills in the legal content without touching App.tsx.
export function ImpressumPage() {
  const { t } = useTranslation()
  return (
    <div className="page-stack">
      <h1>{t('legal.impressumTitle')}</h1>
      <p>{t('legal.comingSoon')}</p>
    </div>
  )
}
