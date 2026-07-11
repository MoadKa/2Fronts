import { useEffect, useState, type SVGProps } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getAutomationById } from '../../services/AutomationService'
import { localizeAutomation, localizeCategory } from '../../lib/localizeAutomation'
import { useDocumentMeta } from '../../hooks/useDocumentMeta'
import { createRequest, createCheckoutSession, createProvisionDetails } from '../../services/RequestService'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/ui/Toast'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import type { Automation } from '../../types/database'
import './AutomationDetailPage.css'

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

type IconProps = SVGProps<SVGSVGElement>

function ArrowLeftIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </svg>
  )
}

function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}

function LockIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.25" />
    </svg>
  )
}

export function AutomationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { t, i18n } = useTranslation()
  const [automation, setAutomation] = useState<Automation | null>(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [bookingLink, setBookingLink] = useState('')
  const [bookingLinkError, setBookingLinkError] = useState('')

  useEffect(() => {
    if (!id) return
    getAutomationById(id).then((data) => {
      setAutomation(data)
      setLoading(false)
    })
  }, [id])

  // Hooks must run unconditionally, so this sits before the loading/not-found
  // early returns below. Falls back to the generic site title while the
  // automation is still loading or missing (see seo-audit-2026-07-08.md #2 —
  // this route previously always rendered the homepage's title).
  const metaLoc = automation ? localizeAutomation(automation, i18n.language) : null
  useDocumentMeta({
    title: metaLoc ? `${metaLoc.name} — 2Fronts` : '2Fronts',
    description: metaLoc?.outcome_description,
  })

  async function handleRequest() {
    if (!automation) return
    // The business-name + booking-link fields are Twilio-missed-call only. Other
    // provisioned connectors configure elsewhere: the booking concierge sets its
    // calendar link in the setup wizard, Sheets/Slack via OAuth at /connect. So
    // only require the booking link for the Twilio connector — otherwise a coach
    // would have to enter their Calendly here AND again in the wizard.
    if (automation.connector_type === 'twilio_missed_call' && !bookingLink.trim()) {
      setBookingLinkError(t('automationDetail.bookingLinkRequired'))
      return
    }
    setBookingLinkError('')
    setRequesting(true)
    try {
      const request = await createRequest(automation.id)
      // Always create the provision so its connector_type derives from the
      // automation; the Twilio booking details only apply to that connector.
      await createProvisionDetails(request.id, automation.connector_type, {
        businessName,
        bookingLink,
      })
      const { url } = await createCheckoutSession(request.id)
      window.location.href = url
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('automationDetail.checkoutError'), 'error')
      setRequesting(false)
    }
  }

  if (loading) return <p className="detail-status">{t('automationDetail.loading')}</p>
  if (!automation) return <p className="detail-status">{t('automationDetail.notFound')}</p>

  const loc = localizeAutomation(automation, i18n.language)

  return (
    <div className="detail-page page-stack">
      <Link to="/automations" className="detail-back">
        <ArrowLeftIcon className="detail-back-icon" aria-hidden="true" />
        {t('automationDetail.backToCatalog')}
      </Link>

      <div className="detail-layout">
        <Card className="detail-main rise">
          <Badge>{localizeCategory(automation.category, t)}</Badge>
          <h2>{loc.name}</h2>
          <p className="detail-outcome">{loc.outcome_description}</p>
          {loc.summary && loc.summary !== loc.outcome_description && (
            <p className="detail-summary">{loc.summary}</p>
          )}
        </Card>

        <Card className="detail-buy rise">
          <div className="detail-price">
            <span className="detail-price-amount">
              {formatPrice(automation.price_cents, automation.currency)}
            </span>
            <span className="detail-price-note">
              {automation.pricing_model === 'subscription'
                ? t('automationDetail.priceMonthlyLabel', 'pro Monat')
                : t('automationDetail.priceOnceLabel', 'einmalig')}
            </span>
          </div>

          {automation.pricing_model === 'subscription' && (
            <>
              <p className="detail-scarcity">
                {t('automationDetail.scarcityNote')}
              </p>
              {/* Reassurance, not urgency: the trial note stays muted while the
                  scarcity note above keeps the warning tone. */}
              <p className="detail-trial">
                {t('automationDetail.trialNote')}
              </p>
            </>
          )}

          {user ? (
            <>
              {automation.connector_type === 'twilio_missed_call' && (
                <div className="detail-fields">
                  <Input
                    label={t('automationDetail.businessName')}
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                  />
                  <Input
                    label={t('automationDetail.bookingLink')}
                    value={bookingLink}
                    onChange={(e) => setBookingLink(e.target.value)}
                    error={bookingLinkError}
                  />
                </div>
              )}
              <Button className="detail-cta" onClick={handleRequest} disabled={requesting}>
                {requesting ? t('automationDetail.checkoutStarting') : t('automationDetail.requestAutomation')}
              </Button>
              <p className="detail-secure">
                <LockIcon className="detail-secure-icon" aria-hidden="true" />
                {t('automationDetail.secureCheckoutNote', 'Sichere Zahlung über Stripe')}
              </p>
            </>
          ) : (
            <div className="detail-signin">
              <p>{t('automationDetail.signInToRequest')}</p>
            </div>
          )}

          <ul className="detail-assurances">
            <li>
              <CheckIcon className="detail-check" aria-hidden="true" />
              {t('automationDetail.assuranceDelivery', 'Einrichtung durch unser Team')}
            </li>
            <li>
              <CheckIcon className="detail-check" aria-hidden="true" />
              {t('automationDetail.assuranceCancel', 'Keine versteckten Kosten')}
            </li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
