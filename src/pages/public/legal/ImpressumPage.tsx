import { useTranslation } from 'react-i18next'
import { LegalLayout, LegalSection } from './LegalLayout'

// Impressum (legal notice) pursuant to Section 5 TMG. Founder-specific values
// are placeholders ([NAME], [ANSCHRIFT], [EMAIL], [TELEFON], [USt-IdNr ...])
// to be filled with eRecht24-generated data before publication.
export function ImpressumPage() {
  const { t } = useTranslation()
  return (
    <LegalLayout title={t('legal.impressum.title')} draft>
      <p>{t('legal.impressum.intro')}</p>

      <LegalSection
        heading={t('legal.impressum.providerHeading')}
        body={t('legal.impressum.providerBody')}
      />

      <section>
        <h2>{t('legal.impressum.contactHeading')}</h2>
        <p>
          {t('legal.impressum.contactPhoneLabel')}: {t('legal.impressum.contactPhone')}
        </p>
        <p>
          {t('legal.impressum.contactEmailLabel')}: {t('legal.impressum.contactEmail')}
        </p>
      </section>

      <LegalSection
        heading={t('legal.impressum.vatHeading')}
        body={t('legal.impressum.vatBody')}
      />
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
