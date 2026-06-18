import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MyRequestsPage } from './MyRequestsPage'
import { listMyRequests } from '../../services/RequestService'

vi.mock('../../services/RequestService', () => ({ listMyRequests: vi.fn() }))

const baseRequest = {
  id: 'req-1', automation_id: 'auto-1', customer_id: 'user-1',
  stripe_checkout_session_id: 'sess-1', requested_at: '2026-06-18T00:00:00Z', paid_at: null, delivered_at: null,
  automation: { id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'y', category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z' },
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
    await waitFor(() => expect(screen.getByText("You haven't requested any automations yet.")).toBeInTheDocument())
  })
})
