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
