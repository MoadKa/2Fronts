import { useEffect, useState, type FormEvent } from 'react'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/Toast'
import { submitMarketplaceCapture } from '../../services/MarketplaceCaptureService'

interface Listing {
  id: string
  name: string
  outcomeDescription: string
  featured: boolean
}

const LISTINGS: Listing[] = [
  {
    id: 'missed-call-recovery',
    name: 'AI Missed-Call Recovery',
    outcomeDescription: 'Texts back every missed call instantly and books the job.',
    featured: true,
  },
  {
    id: 'invoice-followup',
    name: 'Invoice Follow-Up',
    outcomeDescription: 'Reminds customers about unpaid invoices automatically.',
    featured: false,
  },
  {
    id: 'review-requests',
    name: 'Review Request Automation',
    outcomeDescription: 'Asks happy customers for a review right after the job is done.',
    featured: false,
  },
]

function useNoindexMeta() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => {
      document.head.removeChild(meta)
    }
  }, [])
}

export function MarketplaceTestPage() {
  useNoindexMeta()
  const { showToast } = useToast()

  const [email, setEmail] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [automationOfInterest, setAutomationOfInterest] = useState('')
  const [emailError, setEmailError] = useState('')
  const [businessNameError, setBusinessNameError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function handleInterested(listingName: string) {
    setAutomationOfInterest(listingName)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return

    const trimmedEmail = email.trim()
    const trimmedBusinessName = businessName.trim()
    setEmailError(trimmedEmail === '' ? 'Email is required' : '')
    setBusinessNameError(trimmedBusinessName === '' ? 'Business name is required' : '')
    if (trimmedEmail === '' || trimmedBusinessName === '') return

    setSubmitting(true)
    try {
      await submitMarketplaceCapture({
        email: trimmedEmail,
        businessName: trimmedBusinessName,
        automationOfInterest,
      })
      showToast("Thanks — we'll be in touch", 'success')
      setEmail('')
      setBusinessName('')
      setAutomationOfInterest('')
    } catch {
      showToast('Could not send — please try again', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h2>Automations</h2>
      {LISTINGS.map((listing) => (
        <Card key={listing.id}>
          <h3>{listing.name}</h3>
          <p>{listing.outcomeDescription}</p>
          {listing.featured && <Badge tone="success">Live</Badge>}
          <Button variant="secondary" type="button" onClick={() => handleInterested(listing.name)}>
            Interested? Tell us
          </Button>
        </Card>
      ))}

      <form onSubmit={handleSubmit}>
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
        />
        <Input
          label="Business name"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          error={businessNameError}
        />
        <Input
          label="Automation of interest"
          placeholder="Click 'Interested?' on a listing above, or describe what you're looking for"
          value={automationOfInterest}
          onChange={(e) => setAutomationOfInterest(e.target.value)}
        />
        <Button type="submit" disabled={submitting}>
          Request an automation
        </Button>
      </form>
    </div>
  )
}
