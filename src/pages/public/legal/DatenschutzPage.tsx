import { useTranslation } from 'react-i18next'
import { LegalLayout, LegalSection } from './LegalLayout'

// Datenschutzerklärung (GDPR privacy policy). DRAFT — must be reviewed before
// publication. Section 6.1 carries the Google API Services User Data Policy /
// Limited Use disclosure verbatim (required for Google OAuth verification).
export function DatenschutzPage() {
  const { t } = useTranslation()
  return (
    <LegalLayout title={t('legal.datenschutz.title')} draft>
      <p>{t('legal.datenschutz.intro')}</p>

      <LegalSection
        heading={t('legal.datenschutz.controllerHeading')}
        body={t('legal.datenschutz.controllerBody')}
      />
      <LegalSection
        heading={t('legal.datenschutz.scopeHeading')}
        body={t('legal.datenschutz.scopeBody')}
      />
      <LegalSection
        heading={t('legal.datenschutz.legalBasisHeading')}
        body={t('legal.datenschutz.legalBasisBody')}
      />
      <LegalSection
        heading={t('legal.datenschutz.supabaseHeading')}
        body={t('legal.datenschutz.supabaseBody')}
      />
      <LegalSection
        heading={t('legal.datenschutz.stripeHeading')}
        body={t('legal.datenschutz.stripeBody')}
      />
      <LegalSection
        heading={t('legal.datenschutz.googleHeading')}
        body={t('legal.datenschutz.googleBody')}
      />

      {/* Google API Services User Data Policy — Limited Use (verbatim). */}
      <section>
        <h2>{t('legal.datenschutz.googleLimitedUseHeading')}</h2>
        <p>{t('legal.datenschutz.googleLimitedUseBody')}</p>
        <p>{t('legal.datenschutz.googleLimitedUseVerbatimLabel')}</p>
        <blockquote>{t('legal.datenschutz.googleLimitedUseVerbatim')}</blockquote>
      </section>

      <LegalSection
        heading={t('legal.datenschutz.slackHeading')}
        body={t('legal.datenschutz.slackBody')}
      />
      <LegalSection
        heading={t('legal.datenschutz.cookiesHeading')}
        body={t('legal.datenschutz.cookiesBody')}
      />
      <LegalSection
        heading={t('legal.datenschutz.retentionHeading')}
        body={t('legal.datenschutz.retentionBody')}
      />
      <LegalSection
        heading={t('legal.datenschutz.rightsHeading')}
        body={t('legal.datenschutz.rightsBody')}
      />
      <LegalSection
        heading={t('legal.datenschutz.complaintHeading')}
        body={t('legal.datenschutz.complaintBody')}
      />
      <LegalSection
        heading={t('legal.datenschutz.changesHeading')}
        body={t('legal.datenschutz.changesBody')}
      />
    </LegalLayout>
  )
}
