import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MyRequestsPage } from './MyRequestsPage'
import { listMyRequests } from '../../services/RequestService'

vi.mock('../../services/RequestService', () => ({ listMyRequests: vi.fn() }))

const baseRequest = {
  id: 'req-1', automation_id: 'auto-1', customer_id: 'user-1',
  stripe_checkout_session_id: 'sess-1', requested_at: '2026-06-18T00:00:00Z', paid_at: null, delivered_at: null,
  automation: { id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'y', category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, requires_provisioning: false, created_at: '2026-06-01T00:00:00Z' },
}

const provisioningRequest = {
  ...baseRequest,
  status: 'delivered' as const,
  delivery_notes: null,
  automation: {
    ...baseRequest.automation,
    name: 'AI Receptionist',
    requires_provisioning: true,
  },
}

function withProvision(status: 'pending' | 'provisioning' | 'active' | 'failed' | 'cancelled', overrides: Record<string, unknown> = {}) {
  return {
    ...provisioningRequest,
    automation_provisions: [
      {
        id: 'prov-1',
        request_id: 'req-1',
        business_name: "Joe's Plumbing",
        booking_link: 'https://booking.example.com/joes-plumbing',
        business_hours: null,
        twilio_phone_number: status === 'active' ? '+15551234567' : null,
        twilio_phone_number_sid: status === 'active' ? 'PNxxxx' : null,
        status,
        created_at: '2026-06-18T00:00:00Z',
        updated_at: '2026-06-18T00:00:00Z',
        ...overrides,
      },
    ],
  }
}

describe('MyRequestsPage', () => {
  it('renders the automation name and status badge for each request', async () => {
    vi.mocked(listMyRequests).mockResolvedValue([{ ...baseRequest, status: 'paid', delivery_notes: null }])
    render(<MyRequestsPage />)
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.getByText('paid')).toBeInTheDocument()
  })

  it('shows delivery notes once a request is delivered', async () => {
    vi.mocked(listMyRequests).mockResolvedValue([{ ...baseRequest, status: 'delivered', delivery_notes: 'Connected to your Gmail and HubSpot.' }])
    render(<MyRequestsPage />)
    await waitFor(() => expect(screen.getByText('Connected to your Gmail and HubSpot.')).toBeInTheDocument())
  })

  it('shows an empty state when there are no requests', async () => {
    vi.mocked(listMyRequests).mockResolvedValue([])
    render(<MyRequestsPage />)
    await waitFor(() => expect(screen.getByText('Du hast noch keine Automatisierungen angefragt.')).toBeInTheDocument())
  })

  // Regression: a request whose automation can't be read (deactivated → RLS hides
  // it, so the join returns null) must NOT crash the whole page. Without the
  // null-guard, `request.automation.requires_provisioning` throws on render.
  it('does not crash when the automation is null (deactivated / RLS-hidden)', async () => {
    vi.mocked(listMyRequests).mockResolvedValue([
      { ...baseRequest, status: 'paid', delivery_notes: null, automation: null } as never,
    ])
    render(<MyRequestsPage />)
    await waitFor(() => expect(screen.getByText('paid')).toBeInTheDocument())
    expect(screen.getByText('Automatisierung')).toBeInTheDocument()
  })

  it('does not render any provisioning content for automations that do not require provisioning', async () => {
    vi.mocked(listMyRequests).mockResolvedValue([{ ...baseRequest, status: 'delivered', delivery_notes: null }])
    render(<MyRequestsPage />)
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.queryByText(/forwarding/i)).not.toBeInTheDocument()
  })

  it('shows a reassuring setup-in-progress message while the provision is pending or provisioning', async () => {
    vi.mocked(listMyRequests).mockResolvedValue([withProvision('pending')])
    render(<MyRequestsPage />)
    await waitFor(() => expect(screen.getByText('AI Receptionist')).toBeInTheDocument())
    expect(screen.getByText(/setting up your ai receptionist/i)).toBeInTheDocument()
    expect(screen.queryByText('+15551234567')).not.toBeInTheDocument()
  })

  it('shows a non-technical message and a contact path when provisioning failed', async () => {
    vi.mocked(listMyRequests).mockResolvedValue([withProvision('failed')])
    render(<MyRequestsPage />)
    await waitFor(() => expect(screen.getByText('AI Receptionist')).toBeInTheDocument())
    const message = screen.getByText(/hit a snag/i)
    expect(message).toBeInTheDocument()
    expect(message.textContent).not.toMatch(/failed|error|status code/i)
    const mailLink = screen.getByText(/support/i, { selector: 'a' })
    expect(mailLink).toHaveAttribute('href', expect.stringContaining('mailto:'))
  })

  it('shows the phone number prominently with tap-to-call and copy actions when active', async () => {
    vi.mocked(listMyRequests).mockResolvedValue([withProvision('active')])
    render(<MyRequestsPage />)
    await waitFor(() => expect(screen.getByText('AI Receptionist')).toBeInTheDocument())

    const callLink = screen.getByRole('link', { name: /\+15551234567/ })
    expect(callLink).toHaveAttribute('href', 'tel:+15551234567')

    expect(screen.getByText(/joe's plumbing/i)).toBeInTheDocument()

    const status = screen.getByText('active')
    expect(status.closest('[aria-live="polite"]')).toBeTruthy()
  })

  it('copies the phone number to the clipboard when the copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    vi.mocked(listMyRequests).mockResolvedValue([withProvision('active')])
    render(<MyRequestsPage />)
    await waitFor(() => expect(screen.getByText('AI Receptionist')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith('+15551234567')
  })

  it('keeps forwarding instructions collapsed by default and reveals them on demand', async () => {
    vi.mocked(listMyRequests).mockResolvedValue([withProvision('active')])
    render(<MyRequestsPage />)
    await waitFor(() => expect(screen.getByText('AI Receptionist')).toBeInTheDocument())

    const disclosure = screen.getByText(/forwarding destination/i).closest('details')
    expect(disclosure).not.toBeNull()
    expect((disclosure as HTMLDetailsElement).open).toBe(false)

    fireEvent.click(screen.getByText(/optional/i))
    expect((disclosure as HTMLDetailsElement).open).toBe(true)
  })
})
