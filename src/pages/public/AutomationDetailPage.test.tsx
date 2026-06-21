import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AutomationDetailPage } from './AutomationDetailPage'
import { getAutomationById } from '../../services/AutomationService'
import { createRequest, createCheckoutSession, createProvisionDetails } from '../../services/RequestService'
import { useAuth } from '../../contexts/AuthContext'
import { ToastProvider } from '../../components/ui/Toast'

vi.mock('../../services/AutomationService', () => ({ getAutomationById: vi.fn() }))
vi.mock('../../services/RequestService', () => ({
  createRequest: vi.fn(),
  createCheckoutSession: vi.fn(),
  createProvisionDetails: vi.fn(),
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

const sampleAutomation = {
  id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'Saves 5 hours/week',
  category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, requires_provisioning: false,
  created_at: '2026-06-01T00:00:00Z',
}

const provisionedAutomation = {
  ...sampleAutomation,
  id: 'auto-2', name: 'AI Missed-Call Recovery', requires_provisioning: true,
}

function renderAt(id: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/automations/${id}`]}>
        <Routes>
          <Route path="/automations/:id" element={<AutomationDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  )
}

describe('AutomationDetailPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })
    vi.mocked(createRequest).mockReset()
    vi.mocked(createCheckoutSession).mockReset()
    vi.mocked(createProvisionDetails).mockReset()
  })

  it('renders the outcome description for a found automation', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(sampleAutomation)
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    renderAt('auto-1')
    await waitFor(() => expect(screen.getByText('Saves 5 hours/week')).toBeInTheDocument())
  })

  it('shows a not-found message when the automation does not exist', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(null)
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    renderAt('missing')
    await waitFor(() => expect(screen.getByText('Automation not found.')).toBeInTheDocument())
  })

  it('prompts signed-out visitors to log in instead of showing the request button', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(sampleAutomation)
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    renderAt('auto-1')
    await waitFor(() => expect(screen.getByText('Log in to request this automation.')).toBeInTheDocument())
  })

  it('creates a request, starts checkout, and redirects to the Stripe URL', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(sampleAutomation)
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'user-1' } as never, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    vi.mocked(createRequest).mockResolvedValue({
      id: 'req-1', automation_id: 'auto-1', customer_id: 'user-1', status: 'requested',
      stripe_checkout_session_id: null, delivery_notes: null, requested_at: '2026-06-18T00:00:00Z', paid_at: null, delivered_at: null,
    })
    vi.mocked(createCheckoutSession).mockResolvedValue({ url: 'https://checkout.stripe.com/session-1' })
    renderAt('auto-1')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Request this automation' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Request this automation' }))
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledWith('req-1'))
    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/session-1'))
  })

  it('shows a booking link field for automations that require provisioning', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(provisionedAutomation)
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'user-1' } as never, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    renderAt('auto-2')
    await waitFor(() => expect(screen.getByLabelText('Booking link')).toBeInTheDocument())
  })

  it('does not show a booking link field for automations that do not require provisioning', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(sampleAutomation)
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'user-1' } as never, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    renderAt('auto-1')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Request this automation' })).toBeInTheDocument())
    expect(screen.queryByLabelText('Booking link')).not.toBeInTheDocument()
  })

  it('blocks checkout until a booking link is entered for provisioned automations', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(provisionedAutomation)
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'user-1' } as never, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    renderAt('auto-2')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Request this automation' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Request this automation' }))
    expect(createRequest).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Enter a booking link so customers can reach you.')).toBeInTheDocument())
  })

  it('submits provisioning details before starting checkout for provisioned automations', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(provisionedAutomation)
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'user-1' } as never, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    vi.mocked(createRequest).mockResolvedValue({
      id: 'req-2', automation_id: 'auto-2', customer_id: 'user-1', status: 'requested',
      stripe_checkout_session_id: null, delivery_notes: null, requested_at: '2026-06-18T00:00:00Z', paid_at: null, delivered_at: null,
    })
    vi.mocked(createCheckoutSession).mockResolvedValue({ url: 'https://checkout.stripe.com/session-2' })
    renderAt('auto-2')
    await waitFor(() => expect(screen.getByLabelText('Booking link')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Booking link'), { target: { value: 'https://cal.com/acme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request this automation' }))
    await waitFor(() =>
      expect(createProvisionDetails).toHaveBeenCalledWith('req-2', { businessName: '', bookingLink: 'https://cal.com/acme', businessHours: undefined })
    )
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledWith('req-2'))
  })
})
