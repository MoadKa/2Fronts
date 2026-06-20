import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAutomationById } from '../../services/AutomationService'
import { createRequest, createCheckoutSession } from '../../services/RequestService'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/ui/Toast'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import type { Automation } from '../../types/database'

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

export function AutomationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [automation, setAutomation] = useState<Automation | null>(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    if (!id) return
    getAutomationById(id).then((data) => {
      setAutomation(data)
      setLoading(false)
    })
  }, [id])

  async function handleRequest() {
    if (!automation) return
    setRequesting(true)
    try {
      const request = await createRequest(automation.id)
      const { url } = await createCheckoutSession(request.id)
      window.location.href = url
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start checkout', 'error')
      setRequesting(false)
    }
  }

  if (loading) return <p>Loading...</p>
  if (!automation) return <p>Automation not found.</p>

  return (
    <div className="page-stack">
      <Link to="/">&larr; Back to catalog</Link>
      <Card>
        <Badge>{automation.category}</Badge>
        <h2>{automation.name}</h2>
        <p>{automation.outcome_description}</p>
        <h3>{formatPrice(automation.price_cents, automation.currency)}</h3>
        {user ? (
          <Button onClick={handleRequest} disabled={requesting}>
            {requesting ? 'Starting checkout...' : 'Request this automation'}
          </Button>
        ) : (
          <p>Log in to request this automation.</p>
        )}
      </Card>
    </div>
  )
}
