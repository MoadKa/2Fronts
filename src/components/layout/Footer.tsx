import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from './LanguageSwitcher'
import './Footer.css'

export function Footer() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  return (
    <footer className="app-footer">
      <nav className="app-footer-links" aria-label={t('footer.impressum')}>
        <Link to="/impressum">{t('footer.impressum')}</Link>
        <Link to="/datenschutz">{t('footer.datenschutz')}</Link>
        <Link to="/agb">{t('footer.agb')}</Link>
      </nav>
      <div className="app-footer-meta">
        <span className="app-footer-rights">{t('footer.rights', { year })}</span>
        <LanguageSwitcher />
      </div>
    </footer>
  )
}
