import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AdminRequestsPage } from './AdminRequestsPage'
import { listAllRequests, updateRequestStatus, retryProvisioning } from '../../services/RequestService'
import { ToastProvider } from '../../components/ui/Toast'
import type { AutomationProvision, AutomationProvisionStatus } from '../../types/database'

vi.mock('../../services/RequestService', () => ({
  listAllRequests: vi.fn(),
  updateRequestStatus: vi.fn(),
  retryProvisioning: vi.fn(),
}))

const baseRequest = {
  id: 'req-1', automation_id: 'auto-1', customer_id: 'user-1', stripe_checkout_session_id: 'sess-1',
  delivery_notes: null, requested_at: '2026-06-18T00:00:00Z', paid_at: '2026-06-18T01:00:00Z', delivered_at: null,
  automation: { id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'y', category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, requires_provisioning: false, connector_type: 'google_sheets', created_at: '2026-06-01T00:00:00Z' },
}

const provisionedRequest = {
  ...baseRequest,
  automation: { ...baseRequest.automation, requires_provisioning: true },
}

function makeProvision(overrides: Partial<{ status: AutomationProvisionStatus; twilio_phone_number: string | null }> = {}): AutomationProvision {
  return {
    id: 'prov-1', request_id: 'req-1', business_name: 'Acme', booking_link: 'https://book.example.com',
    business_hours: null, twilio_phone_number: null, twilio_phone_number_sid: null,
    status: 'pending', created_at: '2026-06-18T00:00:00Z', updated_at: '2026-06-18T00:00:00Z',
    ...overrides,
  }
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

  it('re-fetches with the selected status filter', async () => {
    vi.mocked(listAllRequests).mockResolvedValue([{ ...baseRequest, status: 'paid' }])
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(listAllRequests).toHaveBeenCalledWith(undefined)

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'paid' } })

    await waitFor(() => expect(listAllRequests).toHaveBeenCalledWith({ status: 'paid' }))
  })

  it('does not show provisioning info when requires_provisioning is false', async () => {
    vi.mocked(listAllRequests).mockResolvedValue([
      { ...baseRequest, status: 'paid', automation_provisions: [makeProvision({ status: 'failed' })] },
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.queryByText('failed')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('shows the provisioning status for a provisioned request', async () => {
    vi.mocked(listAllRequests).mockResolvedValue([
      { ...provisionedRequest, status: 'paid', automation_provisions: [makeProvision({ status: 'provisioning' })] },
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.getByText('provisioning')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('shows the twilio phone number when provisioning is active', async () => {
    vi.mocked(listAllRequests).mockResolvedValue([
      {
        ...provisionedRequest,
        status: 'paid',
        automation_provisions: [makeProvision({ status: 'active', twilio_phone_number: '+15551234567' })],
      },
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('+15551234567')).toBeInTheDocument()
  })

  it('shows a retry button for failed provisioning and refreshes after retrying', async () => {
    vi.mocked(listAllRequests)
      .mockResolvedValueOnce([
        { ...provisionedRequest, status: 'paid', automation_provisions: [makeProvision({ status: 'failed' })] },
      ])
      .mockResolvedValueOnce([
        {
          ...provisionedRequest,
          status: 'paid',
          automation_provisions: [makeProvision({ status: 'active', twilio_phone_number: '+15551234567' })],
        },
      ])
    vi.mocked(retryProvisioning).mockResolvedValue({ status: 'active' })
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(retryProvisioning).toHaveBeenCalledWith('req-1'))
    await waitFor(() => expect(screen.getByText('active')).toBeInTheDocument())
    expect(screen.getByText('+15551234567')).toBeInTheDocument()
  })
})
