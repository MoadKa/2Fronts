import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { listMyRequests, createPortalSession } from '../../services/RequestService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import type { AutomationProvision, AutomationRequestWithAutomation, RequestStatus } from '../../types/database'
import './MyRequestsPage.css'

const STATUS_TONE: Record<RequestStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  requested: 'neutral',
  payment_pending: 'neutral',
  paid: 'warning',
  in_progress: 'warning',
  delivered: 'success',
  cancelled: 'danger',
}

const PROVISION_TONE: Record<AutomationProvision['status'], 'neutral' | 'success' | 'warning' | 'danger'> = {
  pending: 'neutral',
  provisioning: 'warning',
  active: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

function ProvisionPanel({ provision }: { provision: AutomationProvision }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)

  const handleCopy = () => {
    if (!provision.twilio_phone_number) return
    navigator.clipboard.writeText(provision.twilio_phone_number)
    setCopied(true)
  }

  // Self-serve subscription management (Stripe Billing Portal): update card, see
  // invoices, cancel. Shown only when there's an active subscription to manage.
  async function openPortal() {
    setPortalLoading(true)
    try {
      window.location.assign(await createPortalSession(provision.id))
    } catch {
      setPortalLoading(false)
    }
  }

  const subscriptionManage = provision.stripe_subscription_id ? (
    <Button variant="secondary" onClick={openPortal} disabled={portalLoading}>
      {t('myRequests.manageSubscription')}
    </Button>
  ) : null

  // The AI Booking Concierge has no OAuth step, so nothing redirects the buyer
  // into setup after payment. Surface the entry point here: a button into the
  // onboarding wizard (/connect/:provisionId/confirm) until the concierge row
  // has been created (config.concierge_id set), then a "you're set up" note.
  if (provision.connector_type === 'booking_concierge') {
    const configured = Boolean((provision.config as { concierge_id?: string } | null)?.concierge_id)
    return (
      <div className="provision-panel">
        <div className="provision-status-row" aria-live="polite">
          <Badge tone={PROVISION_TONE[provision.status]}>{provision.status}</Badge>
        </div>
        {configured ? (
          <>
            <p className="provision-message">{t('myRequests.conciergeReady')}</p>
            <Link to="/app/chats">
              <Button>{t('myRequests.openDashboard')}</Button>
            </Link>
          </>
        ) : (
          <Link to={`/connect/${provision.id}/confirm`}>
            <Button>{t('myRequests.setUpConcierge')}</Button>
          </Link>
        )}
        {subscriptionManage}
      </div>
    )
  }

  return (
    <div className="provision-panel">
      <div className="provision-status-row" aria-live="polite">
        <Badge tone={PROVISION_TONE[provision.status]}>{provision.status}</Badge>
        {provision.status === 'active' && provision.twilio_phone_number && (
          <span className="provision-phone">
            <a href={`tel:${provision.twilio_phone_number}`}>{provision.twilio_phone_number}</a>
            <button type="button" className="provision-copy-btn" onClick={handleCopy}>
              {copied ? t('myRequests.copied') : t('myRequests.copy')}
            </button>
          </span>
        )}
      </div>

      {(provision.status === 'pending' || provision.status === 'provisioning') && (
        <p className="provision-message">
          {t('myRequests.settingUp', { businessName: provision.business_name })}
        </p>
      )}

      {provision.status === 'failed' && (
        <p className="provision-message">
          {t('myRequests.failedPrefix', { businessName: provision.business_name })}{' '}
          <a href="mailto:support@2fronts.com">{t('myRequests.contactSupport')}</a>.
        </p>
      )}

      {provision.status === 'active' && provision.twilio_phone_number && (
        <>
          <p className="provision-message">
            {t('myRequests.active', {
              businessName: provision.business_name,
              phone: provision.twilio_phone_number,
            })}
          </p>
          <details className="provision-forwarding">
            <summary>{t('myRequests.forwardingSummary')}</summary>
            <ol>
              <li>{t('myRequests.forwardingStep1')}</li>
              <li>{t('myRequests.forwardingStep2')}</li>
              <li>{t('myRequests.forwardingStep3', { phone: provision.twilio_phone_number })}</li>
              <li>{t('myRequests.forwardingStep4')}</li>
            </ol>
          </details>
        </>
      )}
      {subscriptionManage}
    </div>
  )
}

export function MyRequestsPage() {
  const { t } = useTranslation()
  const [requests, setRequests] = useState<AutomationRequestWithAutomation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listMyRequests().then((data) => {
      setRequests(data)
      setLoading(false)
    })
  }, [])

  return (
    <div className="my-requests">
      <div className="page-header">
        <h1>{t('myRequests.title')}</h1>
      </div>
      {loading && (
        <div className="my-requests-loading" aria-live="polite">
          <span className="my-requests-spinner" aria-hidden="true" />
          <p>{t('myRequests.loading')}</p>
        </div>
      )}
      {!loading && requests.length === 0 && (
        <div className="empty-state my-requests-empty rise">
          <span className="my-requests-empty-mark" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2.5" />
              <path d="M3 9h18M8 14h8" />
            </svg>
          </span>
          <p>{t('myRequests.empty')}</p>
        </div>
      )}
      {!loading && requests.length > 0 && (
        <div className="my-requests-list rise-stagger">
          {requests.map((request) => {
            // `automation` can be null when the customer can't read it — e.g. it was
            // deactivated (RLS only exposes is_active=true automations to customers).
            // Guard against it so the whole page doesn't crash on one stale request.
            const automation = request.automation
            const provision = automation?.requires_provisioning
              ? request.automation_provisions?.[0]
              : undefined

            return (
              <Card key={request.id} className="my-requests-card">
                <div className="my-requests-card-head">
                  <h3>{automation?.name ?? t('common.automationFallback')}</h3>
                  <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>
                </div>
                {request.status === 'delivered' && request.delivery_notes && (
                  <p className="my-requests-notes">{request.delivery_notes}</p>
                )}
                {provision && <ProvisionPanel provision={provision} />}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
