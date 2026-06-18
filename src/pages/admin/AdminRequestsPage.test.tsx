import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AdminRequestsPage } from './AdminRequestsPage'
import { listAllRequests, updateRequestStatus } from '../../services/RequestService'
import { ToastProvider } from '../../components/ui/Toast'

vi.mock('../../services/RequestService', () => ({ listAllRequests: vi.fn(), updateRequestStatus: vi.fn() }))

const baseRequest = {
  id: 'req-1', automation_id: 'auto-1', customer_id: 'user-1', stripe_checkout_session_id: 'sess-1',
  delivery_notes: null, requested_at: '2026-06-18T00:00:00Z', paid_at: '2026-06-18T01:00:00Z', delivered_at: null,
  automation: { id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'y', category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z' },
}

function renderPage() {
  return render(<ToastProvider><AdminRequestsPage /></ToastProvider>)
}

describe('AdminRequestsPage', () => {
  it('shows the next-status action for a paid request', async () => {
    vi.mocked(listAllRequests).mockResolvedValue([{ ...baseRequest, status: 'paid' }])
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Mark in_progress' })).toBeInTheDocument()
  })

  it('shows a delivery notes field and advances to delivered with notes', async () => {
    vi.mocked(listAllRequests).mockResolvedValue([{ ...baseRequest, status: 'in_progress' }])
    vi.mocked(updateRequestStatus).mockResolvedValue({ ...baseRequest, status: 'delivered' })
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Delivery notes'), { target: { value: 'Connected Gmail + HubSpot' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }))
    await waitFor(() =>
      expect(updateRequestStatus).toHaveBeenCalledWith('req-1', 'delivered', 'Connected Gmail + HubSpot')
    )
  })

  it('shows no action button for a delivered request', async () => {
    vi.mocked(listAllRequests).mockResolvedValue([{ ...baseRequest, status: 'delivered' }])
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no requests', async () => {
    vi.mocked(listAllRequests).mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(screen.getByText('No requests yet.')).toBeInTheDocument())
  })
})
