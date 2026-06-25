import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  createConcierge,
  draftConciergeFromUrl,
  linkProvisionToConcierge,
  type ConciergeLanguage,
} from '../../services/ConciergeService'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { ProgressBar } from '../../components/ui/ProgressBar'
import {
  CONTENT_STEPS,
  emptyWizardData,
  isValidBookingUrl,
  nextStep,
  prevStep,
  progressFor,
  slugify,
  TONE_PRESETS,
  validateStep,
  type TonePreset,
  type WizardData,
  type WizardStep,
} from './conciergeWizard'
import './MappingConfirmationPage.css'
import './ConciergeSetupPage.css'

// The Apple-first-run-style onboarding wizard for the AI Booking Concierge (#26).
// Replaces the basic setup form from #24: a warm welcome + EN/DE language toggle,
// one question per step with a visible progress bar and back/next, and a
// "you're live" finish. It keeps #24's behaviour end-to-end — it creates the
// concierges row via createConcierge, links the purchase provision, derives the
// public slug, and shows the live /c/<slug> link with copy + test buttons.
//
// Pure rules (step order, progress math, validation, URL/slug checks) live in
// conciergeWizard.ts and are unit-tested there; this file is the guided shell.

export function ConciergeSetupPage() {
  const { provisionId } = useParams<{ provisionId: string }>()
  const { t, i18n } = useTranslation()

  // Start the concierge language at the app's current language (welcome lets the
  // coach change it). i18n.language can be "en-US"; collapse to our two options.
  const initialLang: ConciergeLanguage = i18n.language?.startsWith('en') ? 'en' : 'de'

  const [step, setStep] = useState<WizardStep>('welcome')
  const [data, setData] = useState<WizardData>(() => emptyWizardData(initialLang))
  const [error, setError] = useState<string | null>(null) // step error KEY
  const [formError, setFormError] = useState<string | null>(null) // resolved submit error

  const [scrapeUrl, setScrapeUrl] = useState('')
  const [scrapeState, setScrapeState] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle')

  const [saving, setSaving] = useState(false)
  const [createdSlug, setCreatedSlug] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function update(patch: Partial<WizardData>) {
    setData((d) => ({ ...d, ...patch }))
  }

  // Advance from a content step, validating it first. The last content step
  // (tone) submits instead of advancing.
  function goNext() {
    const err = validateStep(step, data)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    if (step === 'tone') {
      void handleSubmit()
      return
    }
    setStep(nextStep(step))
  }

  function goBack() {
    setError(null)
    setStep(prevStep(step))
  }

  // The optional accelerator: scrape the coach's site and prefill offer/qa/tone/
  // calendar from the server draft. Best-effort — any failure shows a gentle
  // note and leaves the coach to type it in. Never blocks the step.
  async function handleScrape() {
    if (!isValidBookingUrl(scrapeUrl)) {
      setScrapeState('failed')
      return
    }
    setScrapeState('loading')
    try {
      const draft = await draftConciergeFromUrl(scrapeUrl.trim(), data.language)
      // The scrape can return a 200 with an EMPTY draft (e.g. a JS-shell page
      // that yielded no usable text). Don't claim success and prefill nothing —
      // that reads as "done" with blank fields. Treat empty as a failure so the
      // coach gets the honest "fill it in manually" note instead.
      const hasContent = !!(
        draft.offer_description || draft.qa || draft.tone || draft.calendar_url
      )
      if (!hasContent) {
        setScrapeState('failed')
        return
      }
      update({
        ...(draft.offer_description ? { offer: draft.offer_description } : {}),
        ...(draft.qa ? { qa: draft.qa } : {}),
        ...(draft.tone ? { tone: draft.tone } : {}),
        ...(draft.calendar_url ? { calendarUrl: draft.calendar_url } : {}),
      })
      setScrapeState('done')
    } catch {
      setScrapeState('failed')
    }
  }

  async function handleSubmit() {
    if (saving) return
    setFormError(null)
    // Final guard: walk every content step's validation before writing.
    for (const s of CONTENT_STEPS) {
      const err = validateStep(s, data)
      if (err) {
        setStep(s)
        setError(err)
        return
      }
    }
    const slug = slugify(data.businessName)

    setSaving(true)
    try {
      const concierge = await createConcierge({
        slug,
        business_name: data.businessName.trim(),
        offer_description: data.offer.trim(),
        qa: data.qa.trim(),
        tone: data.tone,
        language: data.language,
        calendar_url: data.calendarUrl.trim(),
      })

      // Link the purchase provision to the concierge. Best-effort: the concierge
      // already works, so a link failure must not block the live link.
      if (provisionId) {
        try {
          await linkProvisionToConcierge(provisionId, concierge.id)
        } catch {
          // swallow — the concierge is live regardless of the provision link.
        }
      }

      setCreatedSlug(concierge.slug)
      setStep('done')
    } catch (err) {
      const key = err instanceof Error ? err.message : 'conciergeSetup.saveFailed'
      // Map the service's slug-taken error onto the business step so the coach
      // can fix the name that produced the clashing slug.
      if (key === 'conciergeSetup.slugTaken') {
        setStep('business')
        setError('slugTaken')
      } else {
        setFormError(t('conciergeOnboarding.errors.saveFailed'))
      }
      setSaving(false)
    }
  }

  // ---- Done screen (live link + copy + test) ----
  if (step === 'done' && createdSlug) {
    const liveUrl = `${window.location.origin}/c/${createdSlug}`
    return (
      <div className="mapping-wrap">
        <div className="mapping-card wizard-card">
          <ProgressBar ratio={1} current={5} total={5} />
          <h1>{t('conciergeOnboarding.done.title')}</h1>
          <p className="muted">{t('conciergeOnboarding.done.body')}</p>
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
              {copied ? t('conciergeOnboarding.done.copied') : t('conciergeOnboarding.done.copyLink')}
            </button>
            <a className="btn btn-primary" href={`/c/${createdSlug}`} target="_blank" rel="noopener noreferrer">
              {t('conciergeOnboarding.done.test')}
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ---- Welcome screen (language toggle) ----
  if (step === 'welcome') {
    return (
      <div className="mapping-wrap">
        <div className="mapping-card wizard-card">
          <ProgressBar ratio={0} current={0} total={5} />
          <h1>{t('conciergeOnboarding.welcome.title')}</h1>
          <p className="muted">{t('conciergeOnboarding.welcome.body')}</p>

          <fieldset className="wizard-langtoggle">
            <legend>{t('conciergeOnboarding.welcome.languageLabel')}</legend>
            <div className="wizard-langtoggle-options">
              {(['de', 'en'] as ConciergeLanguage[]).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  className={`wizard-choice ${data.language === lang ? 'is-selected' : ''}`}
                  aria-pressed={data.language === lang}
                  onClick={() => update({ language: lang })}
                >
                  {lang === 'de'
                    ? t('conciergeOnboarding.welcome.languageDe')
                    : t('conciergeOnboarding.welcome.languageEn')}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mapping-actions">
            <Button type="button" onClick={() => setStep('business')}>
              {t('conciergeOnboarding.welcome.start')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ---- Content steps ----
  const progress = progressFor(step)
  const stepError = error ? t(`conciergeOnboarding.errors.${error}`) : undefined

  return (
    <div className="mapping-wrap">
      <div className="mapping-card wizard-card">
        <ProgressBar
          ratio={progress.ratio}
          current={progress.current}
          total={progress.total}
          label={t('conciergeOnboarding.stepLabel', { current: progress.current, total: progress.total })}
        />

        {step === 'business' && (
          <div className="wizard-step">
            <h1>{t('conciergeOnboarding.business.title')}</h1>
            <Input
              label={t('conciergeOnboarding.business.title')}
              value={data.businessName}
              onChange={(e) => update({ businessName: e.target.value })}
              placeholder={t('conciergeOnboarding.business.placeholder')}
              error={stepError}
              autoFocus
            />
            <span className="input-hint">{t('conciergeOnboarding.business.hint')}</span>
          </div>
        )}

        {step === 'offer' && (
          <div className="wizard-step">
            <h1>{t('conciergeOnboarding.offer.title')}</h1>

            <div className="wizard-accelerator">
              <p className="muted">{t('conciergeOnboarding.offer.scrapePrompt')}</p>
              <div className="wizard-accelerator-row">
                <input
                  type="url"
                  value={scrapeUrl}
                  onChange={(e) => setScrapeUrl(e.target.value)}
                  placeholder={t('conciergeOnboarding.offer.scrapePlaceholder')}
                  aria-label={t('conciergeOnboarding.offer.scrapePrompt')}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleScrape()}
                  disabled={scrapeState === 'loading'}
                >
                  {scrapeState === 'loading'
                    ? t('conciergeOnboarding.offer.scrapeLoading')
                    : t('conciergeOnboarding.offer.scrapeButton')}
                </Button>
              </div>
              {scrapeState === 'done' && (
                <span className="input-hint wizard-scrape-ok">{t('conciergeOnboarding.offer.scrapeDone')}</span>
              )}
              {scrapeState === 'failed' && (
                <span className="input-hint wizard-scrape-fail">{t('conciergeOnboarding.offer.scrapeFailed')}</span>
              )}
            </div>

            <div className="input-field">
              <label htmlFor="wiz-offer">{t('conciergeOnboarding.offer.title')}</label>
              <textarea
                id="wiz-offer"
                rows={5}
                value={data.offer}
                onChange={(e) => update({ offer: e.target.value })}
                placeholder={t('conciergeOnboarding.offer.placeholder')}
              />
              <span className="input-hint">{t('conciergeOnboarding.offer.hint')}</span>
              {stepError && <span className="input-error">{stepError}</span>}
            </div>
          </div>
        )}

        {step === 'questions' && (
          <div className="wizard-step">
            <h1>{t('conciergeOnboarding.questions.title')}</h1>
            <div className="wizard-chips" aria-hidden="true">
              <span className="wizard-chips-label">{t('conciergeOnboarding.questions.chipsLabel')}</span>
              {(['chipPrice', 'chipDuration', 'chipResults', 'chipStart'] as const).map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="wizard-chip"
                  onClick={() =>
                    update({
                      qa: `${data.qa ? data.qa + '\n' : ''}${t(`conciergeOnboarding.questions.${chip}`)} — `,
                    })
                  }
                >
                  {t(`conciergeOnboarding.questions.${chip}`)}
                </button>
              ))}
            </div>
            <div className="input-field">
              <label htmlFor="wiz-qa">{t('conciergeOnboarding.questions.title')}</label>
              <textarea
                id="wiz-qa"
                rows={6}
                value={data.qa}
                onChange={(e) => update({ qa: e.target.value })}
                placeholder={t('conciergeOnboarding.questions.placeholder')}
              />
              <span className="input-hint">{t('conciergeOnboarding.questions.hint')}</span>
            </div>
          </div>
        )}

        {step === 'booking' && (
          <div className="wizard-step">
            <h1>{t('conciergeOnboarding.booking.title')}</h1>
            <Input
              label={t('conciergeOnboarding.booking.title')}
              type="url"
              value={data.calendarUrl}
              onChange={(e) => update({ calendarUrl: e.target.value })}
              placeholder={t('conciergeOnboarding.booking.placeholder')}
              error={stepError}
              autoFocus
            />
            <span className="input-hint">{t('conciergeOnboarding.booking.hint')}</span>
          </div>
        )}

        {step === 'tone' && (
          <div className="wizard-step">
            <h1>{t('conciergeOnboarding.tone.title')}</h1>
            <p className="muted">{t('conciergeOnboarding.tone.hint')}</p>
            <div className="wizard-tones">
              {TONE_PRESETS.map((preset: TonePreset) => (
                <button
                  key={preset}
                  type="button"
                  className={`wizard-choice wizard-tone ${data.tone === preset ? 'is-selected' : ''}`}
                  aria-pressed={data.tone === preset}
                  onClick={() => update({ tone: preset })}
                >
                  <span className="wizard-tone-name">{t(`conciergeOnboarding.tone.${preset}`)}</span>
                  <span className="wizard-tone-desc">{t(`conciergeOnboarding.tone.${preset}Desc`)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {formError && <p style={{ color: 'var(--color-destructive)' }}>{formError}</p>}

        <div className="wizard-nav">
          <Button type="button" variant="secondary" onClick={goBack}>
            {t('conciergeOnboarding.back')}
          </Button>
          <Button type="button" onClick={goNext} disabled={saving}>
            {step === 'tone'
              ? saving
                ? t('conciergeSetup.saving')
                : t('conciergeOnboarding.tone.finish')
              : t('conciergeOnboarding.next')}
          </Button>
        </div>
      </div>
    </div>
  )
}
