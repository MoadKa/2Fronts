import { useEffect, useState } from 'react'
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
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </span>
        )}
      </div>

      {(provision.status === 'pending' || provision.status === 'provisioning') && (
        <p className="provision-message">
          Setting up your AI receptionist for {provision.business_name} — usually ready within a few minutes.
        </p>
      )}

      {provision.status === 'failed' && (
        <p className="provision-message">
          We hit a snag setting this up for {provision.business_name} — we're on it. Need help sooner?{' '}
          <a href="mailto:support@2fronts.com">Contact support</a>.
        </p>
      )}

      {provision.status === 'active' && provision.twilio_phone_number && (
        <>
          <p className="provision-message">
            {provision.business_name} is live — calls to {provision.twilio_phone_number} are now answered by your AI
            receptionist.
          </p>
          <details className="provision-forwarding">
            <summary>Want missed calls forwarded too? This step is optional — your new number works either way.</summary>
            <ol>
              <li>Open the phone app on your existing business phone.</li>
              <li>Find the call forwarding setting (sometimes called "forward when unanswered" or "forward when busy").</li>
              <li>Enter your new number, {provision.twilio_phone_number}, as the forwarding destination.</li>
              <li>Save. Now if you miss a call on your old number, your AI receptionist picks it up.</li>
            </ol>
          </details>
        </>
      )}
    </div>
  )
}

export function MyRequestsPage() {
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
        <h1>Meine Anfragen</h1>
      </div>
      {loading && <p>Deine Anfragen werden geladen…</p>}
      {!loading && requests.length === 0 && (
        <div className="empty-state">
          <p>Du hast noch keine Automatisierungen angefragt.</p>
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
            <h3>{automation?.name ?? 'Automatisierung'}</h3>
            {request.status === 'delivered' && request.delivery_notes && <p>{request.delivery_notes}</p>}
            {provision && <ProvisionPanel provision={provision} />}
          </Card>
        )
      })}
    </div>
  )
}
