import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CatalogPage } from './CatalogPage'
import { listActiveAutomations } from '../../services/AutomationService'

vi.mock('../../services/AutomationService', () => ({ listActiveAutomations: vi.fn() }))
// CatalogPage renders CatalogRequestSection, which reads auth. Stub it (anonymous).
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }))

describe('CatalogPage', () => {
  it('renders each active automation with name, category, and price', async () => {
    vi.mocked(listActiveAutomations).mockResolvedValue([
      { id: 'auto-1', name: 'Invoice Sync', summary: 'Syncs invoices', outcome_description: 'x', category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, requires_provisioning: false, connector_type: 'google_sheets', created_at: '2026-06-01T00:00:00Z' },
    ])
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.getByText('finance')).toBeInTheDocument()
  })

  // The single-offer card (exactly one active automation) carries the price
  // scarcity note — but only for subscription pricing.
  it('shows the scarcity note on the single-offer card for a subscription automation', async () => {
    vi.mocked(listActiveAutomations).mockResolvedValue([
      { id: 'auto-2', name: 'Concierge', summary: 'Books calls', outcome_description: 'x', category: 'sales', price_cents: 20000, currency: 'eur', pricing_model: 'subscription', recurring_interval: 'month', is_active: true, requires_provisioning: true, connector_type: 'booking_concierge', created_at: '2026-06-24T00:00:00Z' },
    ])
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() =>
      expect(screen.getByText('Nur die nächsten 7 Coaches sichern sich diesen Preis dauerhaft. Danach steigt er.')).toBeInTheDocument()
    )
  })

  it('does not show the scarcity note on the single-offer card for a one-time automation', async () => {
    vi.mocked(listActiveAutomations).mockResolvedValue([
      { id: 'auto-1', name: 'Invoice Sync', summary: 'Syncs invoices', outcome_description: 'x', category: 'finance', price_cents: 49900, currency: 'eur', pricing_model: 'one_time', is_active: true, requires_provisioning: false, connector_type: 'google_sheets', created_at: '2026-06-01T00:00:00Z' },
    ])
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.queryByText(/sichern sich diesen Preis dauerhaft/)).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no automations', async () => {
    vi.mocked(listActiveAutomations).mockResolvedValue([])
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Noch keine Automatisierungen verfügbar.')).toBeInTheDocument())
  })

  // Regression: a rejected fetch must NOT hang on "Loading catalog..." forever.
  // Without the .catch()/.finally(), this test fails (the loading text never clears).
  it('degrades to an error message instead of an infinite spinner when the fetch fails', async () => {
    vi.mocked(listActiveAutomations).mockRejectedValue(new Error('network down'))
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/Katalog konnte gerade nicht geladen werden/i)).toBeInTheDocument())
    expect(screen.queryByText('Loading catalog...')).not.toBeInTheDocument()
  })
})
