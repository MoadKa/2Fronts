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

  if (loading) return <p>Loading your requests...</p>
  if (requests.length === 0) return <p>You haven't requested any automations yet.</p>

  return (
    <div>
      {requests.map((request) => (
        <Card key={request.id} className="my-requests-card">
          <h3>{request.automation.name}</h3>
          <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>
          {request.status === 'delivered' && request.delivery_notes && <p>{request.delivery_notes}</p>}
        </Card>
      ))}
    </div>
  )
}
