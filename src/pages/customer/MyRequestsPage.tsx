import { useEffect, useState } from 'react'
import { listMyRequests } from '../../services/RequestService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import type { AutomationRequestWithAutomation, RequestStatus } from '../../types/database'

const STATUS_TONE: Record<RequestStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  requested: 'neutral',
  payment_pending: 'neutral',
  paid: 'warning',
  in_progress: 'warning',
  delivered: 'success',
  cancelled: 'danger',
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
        <h1>My requests</h1>
      </div>
      {loading && <p>Loading your requests...</p>}
      {!loading && requests.length === 0 && (
        <div className="empty-state">
          <p>You haven't requested any automations yet.</p>
        </div>
      )}
      {!loading && requests.map((request) => (
        <Card key={request.id} className="my-requests-card">
          <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>
          <h3>{request.automation.name}</h3>
          {request.status === 'delivered' && request.delivery_notes && <p>{request.delivery_notes}</p>}
        </Card>
      ))}
    </div>
  )
}
