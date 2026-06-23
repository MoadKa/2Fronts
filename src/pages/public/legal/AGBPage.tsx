import { useTranslation } from 'react-i18next'
import { LegalLayout, LegalSection } from './LegalLayout'

// Lean B2B terms of service (AGB). No Widerrufsbelehrung — buyers are
// businesses (Section 14 BGB). Company specifics are placeholders to be filled
// before publication. DRAFT — lawyer review recommended (epic out-of-scope).
export function AGBPage() {
  const { t } = useTranslation()
  return (
    <LegalLayout title={t('legal.agb.title')}>
      <p>{t('legal.agb.intro')}</p>

      <LegalSection heading={t('legal.agb.scopeHeading')} body={t('legal.agb.scopeBody')} />
      <LegalSection heading={t('legal.agb.serviceHeading')} body={t('legal.agb.serviceBody')} />
      <LegalSection heading={t('legal.agb.contractHeading')} body={t('legal.agb.contractBody')} />
      <LegalSection heading={t('legal.agb.pricesHeading')} body={t('legal.agb.pricesBody')} />
      <LegalSection
        heading={t('legal.agb.obligationsHeading')}
        body={t('legal.agb.obligationsBody')}
      />
      <LegalSection
        heading={t('legal.agb.availabilityHeading')}
        body={t('legal.agb.availabilityBody')}
      />
      <LegalSection heading={t('legal.agb.liabilityHeading')} body={t('legal.agb.liabilityBody')} />
      <LegalSection heading={t('legal.agb.ipHeading')} body={t('legal.agb.ipBody')} />
      <LegalSection heading={t('legal.agb.termHeading')} body={t('legal.agb.termBody')} />
      <LegalSection heading={t('legal.agb.lawHeading')} body={t('legal.agb.lawBody')} />
      <LegalSection
        heading={t('legal.agb.severabilityHeading')}
        body={t('legal.agb.severabilityBody')}
      />
    </LegalLayout>
  )
}
