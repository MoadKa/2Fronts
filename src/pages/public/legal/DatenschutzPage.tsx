import { useTranslation } from 'react-i18next'

// Stub. Sprint A fills in the privacy policy (incl. Google Limited Use clause).
export function DatenschutzPage() {
  const { t } = useTranslation()
  return (
    <div className="page-stack">
      <h1>{t('legal.datenschutzTitle')}</h1>
      <p>{t('legal.comingSoon')}</p>
    </div>
  )
}
