import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getAutomationById } from '../../services/AutomationService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import type { Automation } from '../../types/database'

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

export function AutomationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [automation, setAutomation] = useState<Automation | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    getAutomationById(id).then((data) => {
      setAutomation(data)
      setLoading(false)
    })
  }, [id])

  if (loading) return <p>Loading...</p>
  if (!automation) return <p>Automation not found.</p>

  return (
    <Card>
      <h2>{automation.name}</h2>
      <Badge>{automation.category}</Badge>
      <p>{automation.outcome_description}</p>
      <p>{formatPrice(automation.price_cents, automation.currency)}</p>
    </Card>
  )
}
