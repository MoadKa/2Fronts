import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from './LanguageSwitcher'
import './Footer.css'

export function Footer() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  return (
    <footer className="app-footer">
      <Link to="/" className="app-footer-brand">
        <span>2Fronts</span>
      </Link>
      {/* Static SEO pages live outside the SPA router (served by Vercel from
          /public before the catch-all rewrite), so they use plain <a href>,
          not react-router <Link>, to trigger a real navigation. This also
          gives Google internal links from every page to the money pages. */}
      <nav className="app-footer-links" aria-label={t('footer.resourcesAria')}>
        <a href="/rechner/">{t('footer.calculator')}</a>
        <a href="/ratgeber/appointment-setter-kosten/">{t('footer.guideCosts')}</a>
        <a href="/fuer/coaches/">{t('footer.forCoaches')}</a>
      </nav>
      <nav className="app-footer-links" aria-label={t('footer.impressum')}>
        <Link to="/impressum">{t('footer.impressum')}</Link>
        <Link to="/datenschutz">{t('footer.datenschutz')}</Link>
        <Link to="/agb">{t('footer.agb')}</Link>
        <Link to="/widerruf">{t('footer.widerruf')}</Link>
      </nav>
      <div className="app-footer-support">
        <span className="app-footer-support-label">{t('footer.support')}</span>
        <a href="mailto:support@2fronts.de" aria-label={t('footer.supportAria')}>
          support@2fronts.de
        </a>
      </div>
      <div className="app-footer-meta">
        <span className="app-footer-rights">{t('footer.rights', { year })}</span>
        <LanguageSwitcher />
      </div>
    </footer>
  )
}
