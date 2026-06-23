import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listMyRequests } from '../../services/RequestService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
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

  const handleCopy = () => {
    if (!provision.twilio_phone_number) return
    navigator.clipboard.writeText(provision.twilio_phone_number)
    setCopied(true)
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
    <div>
      <div className="page-header">
        <h1>{t('myRequests.title')}</h1>
      </div>
      {loading && <p>{t('myRequests.loading')}</p>}
      {!loading && requests.length === 0 && (
        <div className="empty-state">
          <p>{t('myRequests.empty')}</p>
        </div>
      )}
      {!loading && requests.map((request) => {
        // `automation` can be null when the customer can't read it — e.g. it was
        // deactivated (RLS only exposes is_active=true automations to customers).
        // Guard against it so the whole page doesn't crash on one stale request.
        const automation = request.automation
        const provision = automation?.requires_provisioning
          ? request.automation_provisions?.[0]
          : undefined

        return (
          <Card key={request.id} className="my-requests-card">
            <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>
            <h3>{automation?.name ?? t('common.automationFallback')}</h3>
            {request.status === 'delivered' && request.delivery_notes && <p>{request.delivery_notes}</p>}
            {provision && <ProvisionPanel provision={provision} />}
          </Card>
        )
      })}
    </div>
  )
}
