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
  price_cents: 49900, currency: 'eur', is_active: true, requires_provisioning: false, created_at: '2026-06-01T00:00:00Z',
}

function renderPage() {
  return render(<ToastProvider><AdminCatalogPage /></ToastProvider>)
}

describe('AdminCatalogPage', () => {
  it('lists existing automations with their active status', async () => {
    vi.mocked(listAllAutomations).mockResolvedValue([sample])
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('submits the form to create a new automation and refreshes the list', async () => {
    vi.mocked(listAllAutomations).mockResolvedValue([])
    vi.mocked(createAutomation).mockResolvedValue(sample)
    renderPage()
    await waitFor(() => expect(listAllAutomations).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Invoice Sync' } })
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('Outcome description'), { target: { value: 'y' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'finance' } })
    fireEvent.change(screen.getByLabelText('Price (cents)'), { target: { value: '49900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add automation' }))
    await waitFor(() =>
      expect(createAutomation).toHaveBeenCalledWith({
        name: 'Invoice Sync', summary: 'x', outcome_description: 'y', category: 'finance', price_cents: 49900,
      })
    )
  })

  it('toggles an automation to inactive when Deactivate is clicked', async () => {
    vi.mocked(listAllAutomations).mockResolvedValue([sample])
    vi.mocked(updateAutomation).mockResolvedValue({ ...sample, is_active: false })
    renderPage()
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(updateAutomation).toHaveBeenCalledWith('auto-1', { is_active: false }))
  })
})
