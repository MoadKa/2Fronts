import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useDocumentMeta } from '../../hooks/useDocumentMeta'
import './AppHomePage.css'

// Public product page submitted to Google as the OAuth consent screen's
// "Application home page". It must be reachable without auth and clearly
// describe what the app does and how it uses Google data, and link the privacy
// policy. Keep it descriptive and honest — Google reviewers read this.
//
// Explicitly NOT noindex: unlike the other utility pages fixed alongside this
// one (seo-audit-2026-07-08.md #2), this route is required by Google's OAuth
// verification to be a real, reachable, descriptive page — it gets its own
// title/description instead.
export function AppHomePage() {
  const { t } = useTranslation()
  useDocumentMeta({
    title: `${t('appHome.heroTitle')} — 2Fronts`,
    description: t('appHome.heroSub'),
  })

  return (
    <div className="app-home">
      <section className="app-home-hero">
        <span className="app-home-eyebrow">{t('appHome.eyebrow')}</span>
        <h1>{t('appHome.heroTitle')}</h1>
        <p className="app-home-sub">{t('appHome.heroSub')}</p>
        <div className="app-home-actions">
          <Link to="/automations" className="btn btn-primary">
            {t('appHome.browseAutomations')}
          </Link>
        </div>
      </section>

      <section className="app-home-what">
        <h2>{t('appHome.whatTitle')}</h2>
        <p>{t('appHome.whatBody')}</p>
      </section>

      <section className="app-home-features">
        <div className="app-home-feature">
          <h3>{t('appHome.feature1Title')}</h3>
          <p>{t('appHome.feature1Body')}</p>
        </div>
        <div className="app-home-feature">
          <h3>{t('appHome.feature2Title')}</h3>
          <p>{t('appHome.feature2Body')}</p>
        </div>
        <div className="app-home-feature">
          <h3>{t('appHome.feature3Title')}</h3>
          <p>{t('appHome.feature3Body')}</p>
        </div>
      </section>

      <section className="app-home-signin">
        <p>{t('appHome.signInPrompt')}</p>
        {/* The sign-in modal lives in the shared nav; sending users to the
            marketplace puts the Sign in / Register button in front of them. */}
        <Link to="/automations" className="btn btn-secondary">
          {t('appHome.signInCta')}
        </Link>
      </section>

      <p className="app-home-privacy">
        {t('appHome.privacyLine')} <Link to="/datenschutz">{t('appHome.privacyLink')}</Link>.
      </p>
      <p className="app-home-note">{t('appHome.footerNote')}</p>
    </div>
  )
}
