import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listAllRequests, updateRequestStatus, retryProvisioning } from '../../services/RequestService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { useDocumentMeta } from '../../hooks/useDocumentMeta'
import type { AutomationProvisionStatus, AutomationRequestWithAutomation, RequestStatus } from '../../types/database'

const STATUS_TONE: Record<RequestStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  requested: 'neutral', payment_pending: 'neutral', paid: 'warning', in_progress: 'warning', delivered: 'success', cancelled: 'danger',
}

const PROVISION_TONE: Record<AutomationProvisionStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  pending: 'neutral', provisioning: 'warning', active: 'success', failed: 'danger', cancelled: 'neutral',
}

const NEXT_STATUS: Record<RequestStatus, RequestStatus | null> = {
  requested: null, payment_pending: null, paid: 'in_progress', in_progress: 'delivered', delivered: null, cancelled: null,
}

const ALL_STATUSES: RequestStatus[] = [
  'requested', 'payment_pending', 'paid', 'in_progress', 'delivered', 'cancelled',
]

export function AdminRequestsPage() {
  const { showToast } = useToast()
  const { t } = useTranslation()
  useDocumentMeta({ title: '2Fronts', noindex: true })
  const [requests, setRequests] = useState<AutomationRequestWithAutomation[]>([])
  const [loading, setLoading] = useState(true)
  const [notesByRequest, setNotesByRequest] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState<RequestStatus | ''>('')

  async function refresh(filterStatus: RequestStatus | '' = statusFilter) {
    setRequests(await listAllRequests(filterStatus ? { status: filterStatus } : undefined))
  }

  useEffect(() => {
    let mounted = true
    listAllRequests(statusFilter ? { status: statusFilter } : undefined).then((requests) => {
      if (mounted) {
        setRequests(requests)
        setLoading(false)
      }
    })
    return () => {
      mounted = false
    }
  }, [statusFilter])

  async function advance(request: AutomationRequestWithAutomation) {
    const nextStatus = NEXT_STATUS[request.status]
    if (!nextStatus) return
    await updateRequestStatus(request.id, nextStatus, notesByRequest[request.id])
    showToast(t('adminRequests.requestMarked', { status: nextStatus }))
    await refresh()
  }

  async function retry(request: AutomationRequestWithAutomation) {
    const { status } = await retryProvisioning(request.id)
    showToast(t('adminRequests.provisioning', { status }))
    await refresh()
  }

  function handleStatusFilterChange(value: string) {
    setLoading(true)
    setStatusFilter(value as RequestStatus | '')
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t('adminRequests.title')}</h1>
      </div>
      <div className="input-field" style={{ maxWidth: 240 }}>
        <label htmlFor="status-filter">{t('adminRequests.status')}</label>
        <select
          id="status-filter"
          value={statusFilter}
          onChange={(e) => handleStatusFilterChange(e.target.value)}
        >
          <option value="">{t('adminRequests.all')}</option>
          {ALL_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>
      {loading && <p>{t('adminRequests.loading')}</p>}
      {!loading && requests.length === 0 && <p>{t('adminRequests.empty')}</p>}
      {!loading && requests.map((request) => {
        const nextStatus = NEXT_STATUS[request.status]
        const provision = request.automation.requires_provisioning
          ? request.automation_provisions?.[0]
          : undefined
        return (
          <Card key={request.id} className="my-requests-card">
            <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>
            <h3>{request.automation.name}</h3>
            {provision && (
              <p>
                <Badge tone={PROVISION_TONE[provision.status]}>{provision.status}</Badge>
                {provision.status === 'active' && provision.twilio_phone_number && (
                  <span> {provision.twilio_phone_number}</span>
                )}
                {provision.status === 'failed' && (
                  <Button onClick={() => retry(request)}>{t('adminRequests.retry')}</Button>
                )}
              </p>
            )}
            {nextStatus === 'delivered' && (
              <Input
                label={t('adminRequests.deliveryNotes')}
                value={notesByRequest[request.id] ?? ''}
                onChange={(e) => setNotesByRequest({ ...notesByRequest, [request.id]: e.target.value })}
              />
            )}
            {nextStatus && <Button onClick={() => advance(request)}>{t('adminRequests.markStatus', { status: nextStatus })}</Button>}
          </Card>
        )
      })}
    </div>
  )
}
