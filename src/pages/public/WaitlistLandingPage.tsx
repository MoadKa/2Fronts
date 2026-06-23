import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { submitWaitlistSignup } from '../../services/WaitlistService'
import './WaitlistLandingPage.css'

// Loose, pragmatic email check mirroring the edge function. The server is the
// source of truth; this just gives instant inline feedback before a round-trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Status = 'idle' | 'submitting' | 'success' | 'already' | 'error'

export function WaitlistLandingPage() {
  const { t, i18n } = useTranslation()
  const [email, setEmail] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (status === 'submitting') return

    const trimmed = email.trim()
    if (trimmed === '') {
      setFieldError(t('waitlist.emailRequired'))
      return
    }
    if (!EMAIL_RE.test(trimmed)) {
      setFieldError(t('waitlist.emailInvalid'))
      return
    }
    setFieldError('')
    setStatus('submitting')
    try {
      const { alreadySubscribed } = await submitWaitlistSignup({
        email: trimmed,
        locale: i18n.language,
        source: 'landing',
      })
      setStatus(alreadySubscribed ? 'already' : 'success')
      setEmail('')
    } catch {
      setStatus('error')
    }
  }

  const submitted = status === 'success' || status === 'already'

  return (
    <div className="waitlist">
      <section className="waitlist-hero">
        <span className="waitlist-eyebrow">{t('waitlist.eyebrow')}</span>
        <h1>{t('waitlist.heroTitle')}</h1>
        <p className="waitlist-sub">{t('waitlist.heroSub')}</p>

        {submitted ? (
          <p className="waitlist-success" role="status">
            {status === 'already' ? t('waitlist.alreadySubscribed') : t('waitlist.success')}
          </p>
        ) : (
          <form className="waitlist-form" onSubmit={handleSubmit} noValidate>
            <Input
              label={t('waitlist.emailLabel')}
              type="email"
              autoComplete="email"
              placeholder={t('waitlist.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={fieldError}
            />
            <Button type="submit" disabled={status === 'submitting'}>
              {status === 'submitting' ? t('waitlist.submitting') : t('waitlist.submit')}
            </Button>
            {status === 'error' && (
              <p className="waitlist-error" role="alert">
                {t('waitlist.error')}
              </p>
            )}
          </form>
        )}

        <p className="waitlist-privacy">
          {t('waitlist.privacyNote')} <Link to="/datenschutz">{t('waitlist.privacyLink')}</Link>.
        </p>
      </section>

      <section className="waitlist-benefits">
        <div className="waitlist-benefit">{t('waitlist.benefit1')}</div>
        <div className="waitlist-benefit">{t('waitlist.benefit2')}</div>
        <div className="waitlist-benefit">{t('waitlist.benefit3')}</div>
      </section>
    </div>
  )
}
