import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n'
import './LanguageSwitcher.css'

const LABELS: Record<SupportedLanguage, string> = { de: 'DE', en: 'EN' }

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  // i18n.language may be a region variant (e.g. "en-US"); reduce to the base.
  const active = (i18n.language?.split('-')[0] ?? 'de') as SupportedLanguage

  return (
    <div className="lang-switcher" role="group" aria-label={t('common.language')}>
      {SUPPORTED_LANGUAGES.map((lng) => (
        <button
          key={lng}
          type="button"
          className={active === lng ? 'lang-btn lang-btn-active' : 'lang-btn'}
          aria-pressed={active === lng}
          onClick={() => i18n.changeLanguage(lng)}
        >
          {LABELS[lng]}
        </button>
      ))}
    </div>
  )
}
