import { useTranslation } from 'react-i18next'
import { LegalLayout, LegalSection } from './LegalLayout'

// Impressum (legal notice) pursuant to Section 5 TMG. Provider data lives in the
// `legal.impressum.*` i18n keys (Moad Kaoukab, Kleinunternehmer §19 UStG — no
// USt-IdNr; contact by email, no phone).
export function ImpressumPage() {
  const { t } = useTranslation()
  return (
    <LegalLayout title={t('legal.impressum.title')}>
      <p>{t('legal.impressum.intro')}</p>

      <LegalSection
        heading={t('legal.impressum.providerHeading')}
        body={t('legal.impressum.providerBody')}
      />

      <section>
        <h2>{t('legal.impressum.contactHeading')}</h2>
        <p>
          {t('legal.impressum.contactEmailLabel')}: {t('legal.impressum.contactEmail')}
        </p>
      </section>

      <LegalSection
        heading={t('legal.impressum.responsibleHeading')}
        body={t('legal.impressum.responsibleBody')}
      />
      <LegalSection
        heading={t('legal.impressum.disputeHeading')}
        body={t('legal.impressum.disputeBody')}
      />
      <LegalSection
        heading={t('legal.impressum.liabilityContentHeading')}
        body={t('legal.impressum.liabilityContentBody')}
      />
      <LegalSection
        heading={t('legal.impressum.liabilityLinksHeading')}
        body={t('legal.impressum.liabilityLinksBody')}
      />
      <LegalSection
        heading={t('legal.impressum.copyrightHeading')}
        body={t('legal.impressum.copyrightBody')}
      />
    </LegalLayout>
  )
}
