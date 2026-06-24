import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  createConcierge,
  linkProvisionToConcierge,
  type ConciergeLanguage,
} from '../../services/ConciergeService'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import './MappingConfirmationPage.css'
import './ConciergeSetupPage.css'

// Basic setup form for the AI Booking Concierge (#24). After a coach buys the
// concierge, ConnectConfirmRoute renders this. It collects the coach's content,
// creates their concierges row (owner = current user), links the purchase
// provision to it, and shows the live /c/<slug> link.
//
// This is deliberately a plain form — #26 replaces it with the guided wizard.

// Slugs become a public URL segment, so keep them URL-safe and predictable.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function ConciergeSetupPage() {
  const { provisionId } = useParams<{ provisionId: string }>()
  const { t } = useTranslation()

  const [businessName, setBusinessName] = useState('')
  const [offer, setOffer] = useState('')
  const [qa, setQa] = useState('')
  const [tone, setTone] = useState('friendly')
  const [language, setLanguage] = useState<ConciergeLanguage>('de')
  const [calendarUrl, setCalendarUrl] = useState('')
  const [slug, setSlug] = useState('')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [createdSlug, setCreatedSlug] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!businessName.trim()) next.businessName = t('conciergeSetup.required')
    if (!offer.trim()) next.offer = t('conciergeSetup.required')
    if (!calendarUrl.trim()) next.calendarUrl = t('conciergeSetup.required')
    if (!slug.trim()) next.slug = t('conciergeSetup.required')
    else if (!SLUG_RE.test(slug.trim())) next.slug = t('conciergeSetup.slugInvalid')
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!validate() || saving) return

    setSaving(true)
    try {
      const concierge = await createConcierge({
        slug: slug.trim(),
        business_name: businessName.trim(),
        offer_description: offer.trim(),
        qa: qa.trim(),
        tone,
        language,
        calendar_url: calendarUrl.trim(),
      })

      // Link the purchase provision to the concierge. Best-effort: the concierge
      // already exists and works, so a link failure must not block the coach from
      // seeing their live link.
      if (provisionId) {
        try {
          await linkProvisionToConcierge(provisionId, concierge.id)
        } catch {
          // swallow — the concierge is live regardless of the provision link.
        }
      }

      setCreatedSlug(concierge.slug)
    } catch (err) {
      const key = err instanceof Error ? err.message : 'conciergeSetup.saveFailed'
      if (key === 'conciergeSetup.slugTaken') {
        setErrors((prev) => ({ ...prev, slug: t('conciergeSetup.slugTaken') }))
      } else {
        setFormError(t(key))
      }
      setSaving(false)
    }
  }

  if (createdSlug) {
    const liveUrl = `${window.location.origin}/c/${createdSlug}`
    return (
      <div className="mapping-wrap">
        <div className="mapping-card">
          <h1>{t('conciergeSetup.successTitle')}</h1>
          <p className="muted">{t('conciergeSetup.successBody')}</p>
          <p className="concierge-live-link">
            <a href={`/c/${createdSlug}`} target="_blank" rel="noopener noreferrer">{liveUrl}</a>
          </p>
          <div className="mapping-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                navigator.clipboard?.writeText(liveUrl)
                setCopied(true)
              }}
            >
              {copied ? t('conciergeSetup.copied') : t('conciergeSetup.copyLink')}
            </button>
            <a className="btn btn-primary" href={`/c/${createdSlug}`} target="_blank" rel="noopener noreferrer">
              {t('conciergeSetup.openLink')}
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mapping-wrap">
      <form className="mapping-card concierge-setup-form" onSubmit={handleSubmit}>
        <h1>{t('conciergeSetup.title')}</h1>
        <p className="muted">{t('conciergeSetup.intro')}</p>

        <Input
          label={t('conciergeSetup.businessName')}
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          error={errors.businessName}
        />

        <div className="input-field">
          <label htmlFor="concierge-offer">{t('conciergeSetup.offerDescription')}</label>
          <textarea
            id="concierge-offer"
            rows={4}
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
          />
          <span className="input-hint">{t('conciergeSetup.offerHint')}</span>
          {errors.offer && <span className="input-error">{errors.offer}</span>}
        </div>

        <div className="input-field">
          <label htmlFor="concierge-qa">{t('conciergeSetup.qa')}</label>
          <textarea
            id="concierge-qa"
            rows={5}
            value={qa}
            onChange={(e) => setQa(e.target.value)}
          />
          <span className="input-hint">{t('conciergeSetup.qaHint')}</span>
        </div>

        <div className="input-field">
          <label htmlFor="concierge-tone">{t('conciergeSetup.tone')}</label>
          <select id="concierge-tone" value={tone} onChange={(e) => setTone(e.target.value)}>
            <option value="friendly">{t('conciergeSetup.toneFriendly')}</option>
            <option value="professional">{t('conciergeSetup.toneProfessional')}</option>
            <option value="casual">{t('conciergeSetup.toneCasual')}</option>
          </select>
        </div>

        <div className="input-field">
          <label htmlFor="concierge-language">{t('conciergeSetup.language')}</label>
          <select
            id="concierge-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as ConciergeLanguage)}
          >
            <option value="de">{t('conciergeSetup.languageDe')}</option>
            <option value="en">{t('conciergeSetup.languageEn')}</option>
          </select>
        </div>

        <Input
          label={t('conciergeSetup.calendarUrl')}
          value={calendarUrl}
          onChange={(e) => setCalendarUrl(e.target.value)}
          error={errors.calendarUrl}
          placeholder="https://cal.com/…"
        />

        <div className="input-field">
          <Input
            label={t('conciergeSetup.slug')}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            error={errors.slug}
            placeholder="mein-name"
          />
          <span className="input-hint">{t('conciergeSetup.slugHint')}</span>
        </div>

        {formError && <p style={{ color: 'var(--color-destructive)' }}>{formError}</p>}

        <div className="mapping-actions">
          <Button type="submit" disabled={saving}>
            {saving ? t('conciergeSetup.saving') : t('conciergeSetup.submit')}
          </Button>
        </div>
      </form>
    </div>
  )
}
