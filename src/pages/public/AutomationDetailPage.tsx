import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAutomationById } from '../../services/AutomationService'
import { createRequest, createCheckoutSession, createProvisionDetails } from '../../services/RequestService'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/ui/Toast'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
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
  const [businessName, setBusinessName] = useState('')
  const [bookingLink, setBookingLink] = useState('')
  const [bookingLinkError, setBookingLinkError] = useState('')

  useEffect(() => {
    if (!id) return
    getAutomationById(id).then((data) => {
      setAutomation(data)
      setLoading(false)
    })
  }, [id])

  async function handleRequest() {
    if (!automation) return
    if (automation.requires_provisioning && !bookingLink.trim()) {
      setBookingLinkError('Bitte gib einen Buchungslink an, über den dich Kunden erreichen.')
      return
    }
    setBookingLinkError('')
    setRequesting(true)
    try {
      const request = await createRequest(automation.id)
      if (automation.requires_provisioning) {
        await createProvisionDetails(request.id, {
          businessName,
          bookingLink,
          businessHours: undefined,
        })
      }
      const { url } = await createCheckoutSession(request.id)
      window.location.href = url
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Checkout konnte nicht gestartet werden', 'error')
      setRequesting(false)
    }
  }

  if (loading) return <p>Wird geladen…</p>
  if (!automation) return <p>Automatisierung nicht gefunden.</p>

  return (
    <div className="page-stack">
      <Link to="/">&larr; Zurück zum Katalog</Link>
      <Card>
        <Badge>{automation.category}</Badge>
        <h2>{automation.name}</h2>
        <p>{automation.outcome_description}</p>
        <h3>{formatPrice(automation.price_cents, automation.currency)}</h3>
        {user ? (
          <>
            {automation.requires_provisioning && (
              <>
                <Input
                  label="Firmenname"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                />
                <Input
                  label="Buchungslink"
                  value={bookingLink}
                  onChange={(e) => setBookingLink(e.target.value)}
                  error={bookingLinkError}
                />
              </>
            )}
            <Button onClick={handleRequest} disabled={requesting}>
              {requesting ? 'Checkout wird gestartet…' : 'Diese Automatisierung anfragen'}
            </Button>
          </>
        ) : (
          <p>Melde dich an, um diese Automatisierung anzufragen.</p>
        )}
      </Card>
    </div>
  )
}
