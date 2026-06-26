import { useTranslation } from 'react-i18next'
import { LegalLayout, LegalSection } from './LegalLayout'

// Terms of service (AGB) for businesses AND consumers, incl. subscriptions
// (Kleinunternehmer §19 UStG, no VAT). Consumer right of withdrawal lives on the
// dedicated Widerruf page; in-app cancellation (§312k) is in My Requests.
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
