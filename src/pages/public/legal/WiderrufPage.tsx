import { useTranslation } from 'react-i18next'
import { LegalLayout, LegalSection } from './LegalLayout'

// Widerrufsbelehrung (consumer right of withdrawal, §§ 312g, 355 BGB) + the
// statutory Muster-Widerrufsformular. Required since consumers can buy
// subscriptions. The §312k cancel button lives in the app (My Requests).
export function WiderrufPage() {
  const { t } = useTranslation()
  return (
    <LegalLayout title={t('legal.widerruf.title')}>
      <p>{t('legal.widerruf.intro')}</p>
      <LegalSection heading={t('legal.widerruf.rightHeading')} body={t('legal.widerruf.rightBody')} />
      <LegalSection
        heading={t('legal.widerruf.consequencesHeading')}
        body={t('legal.widerruf.consequencesBody')}
      />
      <LegalSection heading={t('legal.widerruf.digitalHeading')} body={t('legal.widerruf.digitalBody')} />
      <LegalSection heading={t('legal.widerruf.formHeading')} body={t('legal.widerruf.formBody')} />
    </LegalLayout>
  )
}
