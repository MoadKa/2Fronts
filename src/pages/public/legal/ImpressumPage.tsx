import { useTranslation } from 'react-i18next'
import { LegalLayout, LegalSection } from './LegalLayout'

// Impressum (legal notice) pursuant to Section 5 TMG. Provider data lives in the
// `legal.impressum.*` i18n keys (Moad Kaoukab, Kleinunternehmer §19 UStG — no
// USt-IdNr).
//
// The phone number is rendered, not optional. §5 Abs. 1 Nr. 2 TMG wants a channel
// that enables "unmittelbare Kommunikation"; EuGH C-298/07 lets email stand alone
// only where a comparably fast second route exists. The number was already in both
// locale files and simply never reached the page — restored 2026-08-08.
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
        <p>
          {t('legal.impressum.contactPhoneLabel')}: {t('legal.impressum.contactPhone')}
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
