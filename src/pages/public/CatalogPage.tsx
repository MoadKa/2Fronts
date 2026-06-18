import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listActiveAutomations } from '../../services/AutomationService'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import type { Automation } from '../../types/database'

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

export function CatalogPage() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listActiveAutomations().then((data) => {
      setAutomations(data)
      setLoading(false)
    })
  }, [])

  if (loading) return <p>Loading catalog...</p>
  if (automations.length === 0) return <p>No automations available yet.</p>

  return (
    <div>
      {automations.map((automation) => (
        <Link key={automation.id} to={`/automations/${automation.id}`} className="catalog-card-link">
          <Card>
            <h3>{automation.name}</h3>
            <p>{automation.summary}</p>
            <Badge>{automation.category}</Badge>
            <p>{formatPrice(automation.price_cents, automation.currency)}</p>
          </Card>
        </Link>
      ))}
    </div>
  )
}
