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
        <span className="app-footer-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 18V7l8 5 8-5v11" />
          </svg>
        </span>
        <span>2Fronts</span>
      </Link>
      <nav className="app-footer-links" aria-label={t('footer.impressum')}>
        <Link to="/impressum">{t('footer.impressum')}</Link>
        <Link to="/datenschutz">{t('footer.datenschutz')}</Link>
        <Link to="/agb">{t('footer.agb')}</Link>
        <Link to="/widerruf">{t('footer.widerruf')}</Link>
      </nav>
      <div className="app-footer-meta">
        <span className="app-footer-rights">{t('footer.rights', { year })}</span>
        <LanguageSwitcher />
      </div>
    </footer>
  )
}
