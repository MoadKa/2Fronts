import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { submitWish } from '../../services/WishService'
import { INDUSTRIES, industryLabel } from '../../lib/industries'

// The "didn't find what you're looking for?" capture at the bottom of the
// catalog (replaces the old standalone waitlist landing). Email + free-text
// "what are you missing?" + an EXPLICIT marketing-consent checkbox (DSGVO:
// submit is disabled until it's ticked, and the consent is recorded server-side).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
type Status = 'idle' | 'submitting' | 'success' | 'already' | 'error'

export function CatalogRequestSection() {
  const { t, i18n } = useTranslation()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [industry, setIndustry] = useState('')
  const [consent, setConsent] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [consentError, setConsentError] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (status === 'submitting') return

    const trimmed = email.trim()
    if (trimmed === '') {
      setEmailError(t('catalogRequest.emailRequired'))
      return
    }
    if (!EMAIL_RE.test(trimmed)) {
      setEmailError(t('catalogRequest.emailInvalid'))
      return
    }
    if (!consent) {
      setConsentError(t('catalogRequest.consentRequired'))
      return
    }
    setEmailError('')
    setConsentError('')
    setStatus('submitting')
    try {
      await submitWish({
        email: trimmed,
        locale: i18n.language,
        message: message.trim() || undefined,
        industry: industry || undefined,
        marketingConsent: true,
      })
      setStatus('success')
      setEmail('')
      setMessage('')
      setIndustry('')
      setConsent(false)
    } catch {
      setStatus('error')
    }
  }

  const submitted = status === 'success' || status === 'already'

  return (
    <section id="request" className="catalog-request">
      <h2>{t('catalogRequest.title')}</h2>
      <p className="catalog-request-sub">{t('catalogRequest.sub')}</p>

      {submitted ? (
        <p className="catalog-request-success" role="status">
          {status === 'already' ? t('catalogRequest.alreadySubscribed') : t('catalogRequest.success')}
        </p>
      ) : (
        <form className="catalog-request-form" onSubmit={handleSubmit} noValidate>
          <Input
            label={t('catalogRequest.emailLabel')}
            type="email"
            autoComplete="email"
            placeholder={t('catalogRequest.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={emailError}
          />
          <div className="input-field">
            <label htmlFor="catalog-request-message">{t('catalogRequest.messageLabel')}</label>
            <textarea
              id="catalog-request-message"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('catalogRequest.messagePlaceholder')}
            />
          </div>
          <div className="input-field">
            <label htmlFor="catalog-request-industry">{t('catalogRequest.industryLabel')}</label>
            <select
              id="catalog-request-industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            >
              <option value="">{t('catalogRequest.industryPlaceholder')}</option>
              {INDUSTRIES.map((i) => (
                <option key={i.value} value={i.value}>
                  {industryLabel(i.value, i18n.language)}
                </option>
              ))}
            </select>
          </div>
          <label className="catalog-request-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t('catalogRequest.consentLabel')}</span>
          </label>
          {consentError && <p className="input-error" role="alert">{consentError}</p>}
          <Button type="submit" disabled={status === 'submitting' || !consent}>
            {status === 'submitting' ? t('catalogRequest.submitting') : t('catalogRequest.submit')}
          </Button>
          {status === 'error' && (
            <p className="catalog-request-error" role="alert">{t('catalogRequest.error')}</p>
          )}
        </form>
      )}

      <p className="catalog-request-privacy">
        {t('catalogRequest.privacyNote')} <Link to="/datenschutz">{t('catalogRequest.privacyLink')}</Link>.
      </p>
    </section>
  )
}
