import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n'
import './LanguageSwitcher.css'

const LABELS: Record<SupportedLanguage, string> = { de: 'DE', en: 'EN' }

// On the homepage (/ or /en), switching language navigates to the matching
// indexable URL instead of just toggling content in place — that's what
// makes /en a real, discoverable link for both visitors and crawlers, not
// only reachable via JS (see seo-audit-2026-07-08.md finding #3). Everywhere
// else in the app, the switcher keeps its original in-place toggle.
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const isHomeRoute = location.pathname === '/' || location.pathname === '/en'
  // i18n.language may be a region variant (e.g. "en-US"); reduce to the base.
  const active = (i18n.language?.split('-')[0] ?? 'de') as SupportedLanguage

  const handleClick = (lng: SupportedLanguage) => {
    if (isHomeRoute) {
      navigate(lng === 'en' ? '/en' : '/')
    }
    i18n.changeLanguage(lng)
  }

  return (
    <div className="lang-switcher" role="group" aria-label={t('common.language')}>
      {SUPPORTED_LANGUAGES.map((lng) => (
        <button
          key={lng}
          type="button"
          className={active === lng ? 'lang-btn lang-btn-active' : 'lang-btn'}
          aria-pressed={active === lng}
          onClick={() => handleClick(lng)}
        >
          {LABELS[lng]}
        </button>
      ))}
    </div>
  )
}
