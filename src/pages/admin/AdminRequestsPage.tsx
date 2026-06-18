import { useEffect, useState } from 'react'
import { listAllRequests, updateRequestStatus } from '../../services/RequestService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import type { AutomationRequestWithAutomation, RequestStatus } from '../../types/database'

const STATUS_TONE: Record<RequestStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  requested: 'neutral', payment_pending: 'neutral', paid: 'warning', in_progress: 'warning', delivered: 'success', cancelled: 'danger',
}

const NEXT_STATUS: Record<RequestStatus, RequestStatus | null> = {
  requested: null, payment_pending: null, paid: 'in_progress', in_progress: 'delivered', delivered: null, cancelled: null,
}

export function AdminRequestsPage() {
  const { showToast } = useToast()
  const [requests, setRequests] = useState<AutomationRequestWithAutomation[]>([])
  const [loading, setLoading] = useState(true)
  const [notesByRequest, setNotesByRequest] = useState<Record<string, string>>({})

  async function refresh() {
    setRequests(await listAllRequests())
  }

  useEffect(() => {
    let mounted = true
    listAllRequests().then((requests) => {
      if (mounted) {
        setRequests(requests)
        setLoading(false)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  async function advance(request: AutomationRequestWithAutomation) {
    const nextStatus = NEXT_STATUS[request.status]
    if (!nextStatus) return
    await updateRequestStatus(request.id, nextStatus, notesByRequest[request.id])
    showToast(`Request marked ${nextStatus}`)
    await refresh()
  }

  if (loading) return <p>Loading requests...</p>
  if (requests.length === 0) return <p>No requests yet.</p>

  return (
    <div>
      {requests.map((request) => {
        const nextStatus = NEXT_STATUS[request.status]
        return (
          <Card key={request.id} className="my-requests-card">
            <h3>{request.automation.name}</h3>
            <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>
            {nextStatus === 'delivered' && (
              <Input
                label="Delivery notes"
                value={notesByRequest[request.id] ?? ''}
                onChange={(e) => setNotesByRequest({ ...notesByRequest, [request.id]: e.target.value })}
              />
            )}
            {nextStatus && <Button onClick={() => advance(request)}>Mark {nextStatus}</Button>}
          </Card>
        )
      })}
    </div>
  )
}
