import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AdminCatalogPage } from './AdminCatalogPage'
import { listAllAutomations, createAutomation, updateAutomation } from '../../services/AutomationService'
import { ToastProvider } from '../../components/ui/Toast'

vi.mock('../../services/AutomationService', () => ({
  listAllAutomations: vi.fn(),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
}))

const sample = {
  id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'y', category: 'finance',
  price_cents: 49900, currency: 'eur', is_active: true, requires_provisioning: false, connector_type: 'google_sheets', created_at: '2026-06-01T00:00:00Z',
}

function renderPage() {
  return render(<ToastProvider><AdminCatalogPage /></ToastProvider>)
}

describe('AdminCatalogPage', () => {
  it('lists existing automations with their active status', async () => {
    vi.mocked(listAllAutomations).mockResolvedValue([sample])
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.getByText('aktiv')).toBeInTheDocument()
  })

  it('submits the form to create a new automation and refreshes the list', async () => {
    vi.mocked(listAllAutomations).mockResolvedValue([])
    vi.mocked(createAutomation).mockResolvedValue(sample)
    renderPage()
    await waitFor(() => expect(listAllAutomations).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Invoice Sync' } })
    fireEvent.change(screen.getByLabelText('Kurzbeschreibung'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('Ergebnisbeschreibung'), { target: { value: 'y' } })
    fireEvent.change(screen.getByLabelText('Kategorie'), { target: { value: 'finance' } })
    fireEvent.change(screen.getByLabelText('Preis (Cent)'), { target: { value: '49900' } })
    // Pick a non-default connector + mark it as requiring provisioning, to prove
    // these flow into the create payload (the old form couldn't set them, so every
    // automation silently became twilio_missed_call).
    fireEvent.change(screen.getByLabelText('Connector (Fulfillment)'), { target: { value: 'twilio_missed_call' } })
    fireEvent.click(screen.getByLabelText('Einrichtung erforderlich (z. B. Twilio-Buchungslink)'))
    fireEvent.click(screen.getByRole('button', { name: 'Automatisierung hinzufügen' }))
    await waitFor(() =>
      expect(createAutomation).toHaveBeenCalledWith({
        name: 'Invoice Sync', summary: 'x', outcome_description: 'y', translations: {}, category: 'finance', price_cents: 49900,
        connector_type: 'twilio_missed_call', requires_provisioning: true, is_active: true,
        pricing_model: 'one_time', recurring_interval: null,
      })
    )
  })

  it('creates a monthly (subscription) automation when billing is set to monthly', async () => {
    vi.mocked(listAllAutomations).mockResolvedValue([])
    vi.mocked(createAutomation).mockResolvedValue(sample)
    renderPage()
    await waitFor(() => expect(listAllAutomations).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Concierge' } })
    fireEvent.change(screen.getByLabelText('Preis (Cent)'), { target: { value: '7900' } })
    fireEvent.change(screen.getByLabelText('Abrechnung'), { target: { value: 'subscription' } })
    fireEvent.click(screen.getByRole('button', { name: 'Automatisierung hinzufügen' }))
    await waitFor(() =>
      expect(createAutomation).toHaveBeenCalledWith(
        expect.objectContaining({ price_cents: 7900, pricing_model: 'subscription', recurring_interval: 'month' }),
      )
    )
  })

  it('toggles an automation to inactive when Deactivate is clicked', async () => {
    vi.mocked(listAllAutomations).mockResolvedValue([sample])
    vi.mocked(updateAutomation).mockResolvedValue({ ...sample, is_active: false })
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Deaktivieren' }))
    await waitFor(() => expect(updateAutomation).toHaveBeenCalledWith('auto-1', { is_active: false }))
  })

  it('edits an existing automation price inline and saves the patch', async () => {
    vi.mocked(listAllAutomations).mockResolvedValue([sample])
    vi.mocked(updateAutomation).mockResolvedValue({ ...sample, price_cents: 0 })
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))
    // The edit form pre-fills the current price. Two "Preis (Cent)" inputs now
    // exist (the create form + this edit form); the edit one is the last.
    const priceInputs = screen.getAllByLabelText('Preis (Cent)')
    const editPrice = priceInputs[priceInputs.length - 1] as HTMLInputElement
    expect(editPrice.value).toBe('49900')
    fireEvent.change(editPrice, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(updateAutomation).toHaveBeenCalledWith('auto-1', expect.objectContaining({ price_cents: 0 }))
    )
  })
})
