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

  // The founding-price rule ("only the next 7 coaches") is a scarcity claim,
  // and this page belongs to a company with no customers yet. The founder
  // pinned 200 EUR as the single number the home page states, so the claim
  // lives in public/pricing.md and on the detail page, not here.
  it('does not show the founding-price scarcity claim on the home offer card', async () => {
    vi.mocked(listActiveAutomations).mockResolvedValue([
      { id: 'auto-2', name: 'Concierge', summary: 'Books calls', outcome_description: 'x', category: 'sales', price_cents: 20000, currency: 'eur', pricing_model: 'subscription', recurring_interval: 'month', is_active: true, requires_provisioning: true, connector_type: 'booking_concierge', created_at: '2026-06-24T00:00:00Z' },
    ])
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Concierge')).toBeInTheDocument())
    expect(screen.queryByText(/sichern sich diesen Preis dauerhaft/)).not.toBeInTheDocument()
    // The risk-reversal terms are facts about the offer, not scarcity claims:
    // they stay, and they are the page's entire trust budget.
    expect(screen.getByText('14 Tage kostenlos. Die erste Abbuchung kommt erst danach.')).toBeInTheDocument()
    expect(
      screen.getByText('Bucht der Setter in den ersten 30 Tagen kein einziges Gespräch, bekommst du dein Geld zurück.'),
    ).toBeInTheDocument()
  })

  it('does not show the scarcity note on the single-offer card for a one-time automation', async () => {
    vi.mocked(listActiveAutomations).mockResolvedValue([
      { id: 'auto-1', name: 'Invoice Sync', summary: 'Syncs invoices', outcome_description: 'x', category: 'finance', price_cents: 49900, currency: 'eur', pricing_model: 'one_time', is_active: true, requires_provisioning: false, connector_type: 'google_sheets', created_at: '2026-06-01T00:00:00Z' },
    ])
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.queryByText(/sichern sich diesen Preis dauerhaft/)).not.toBeInTheDocument()
  })

  it('shows the subscription risk terms on the single-offer card', async () => {
    vi.mocked(listActiveAutomations).mockResolvedValue([
      { id: 'auto-2', name: 'Concierge', summary: 'Books calls', outcome_description: 'x', category: 'sales', price_cents: 20000, currency: 'eur', pricing_model: 'subscription', recurring_interval: 'month', is_active: true, requires_provisioning: true, connector_type: 'booking_concierge', created_at: '2026-06-24T00:00:00Z' },
    ])
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() =>
      expect(screen.getByText('14 Tage kostenlos. Die erste Abbuchung kommt erst danach.')).toBeInTheDocument()
    )
    expect(screen.getByText('Monatlich kündbar, selbst im Stripe-Portal, ohne Rückfragen.')).toBeInTheDocument()
  })

  // A one-time product has no trial, no monthly cancellation and no 30-day
  // booking guarantee. Rendering those terms there would be a claim about an
  // offer that does not exist.
  it('does not show the subscription risk terms for a one-time automation', async () => {
    vi.mocked(listActiveAutomations).mockResolvedValue([
      { id: 'auto-1', name: 'Invoice Sync', summary: 'Syncs invoices', outcome_description: 'x', category: 'finance', price_cents: 49900, currency: 'eur', pricing_model: 'one_time', is_active: true, requires_provisioning: false, connector_type: 'google_sheets', created_at: '2026-06-01T00:00:00Z' },
    ])
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    // Match the risk terms, not the CTA: the page's primary button is also
    // labelled "14 Tage kostenlos testen", so the bare phrase appears on every
    // render regardless of pricing model.
    expect(screen.queryByText(/Die erste Abbuchung kommt erst danach/)).not.toBeInTheDocument()
    expect(screen.queryByText(/bekommst du dein Geld zurück/)).not.toBeInTheDocument()
  })

  // Regression: the offer room states the setter's real price, and the catalog
  // room states that prices are not decided yet. If the setter appears in both,
  // one page says 200 EUR and "Preis noch offen" about the same product.
  it('leaves the priced offer out of the catalog list', async () => {
    vi.mocked(listActiveAutomations).mockResolvedValue([
      { id: 'auto-2', name: 'Concierge', summary: 'Books calls', outcome_description: 'x', category: 'sales', price_cents: 20000, currency: 'eur', pricing_model: 'subscription', recurring_interval: 'month', is_active: true, requires_provisioning: true, connector_type: 'booking_concierge', created_at: '2026-06-24T00:00:00Z' },
      { id: 'auto-1', name: 'Invoice Sync', summary: 'Syncs invoices', outcome_description: 'x', category: 'finance', price_cents: 49900, currency: 'eur', pricing_model: 'one_time', is_active: true, requires_provisioning: false, connector_type: 'google_sheets', created_at: '2026-06-01T00:00:00Z' },
    ])
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    // Exactly one row, and it is not the one whose price the page just stated.
    expect(screen.getAllByText('Preis noch offen')).toHaveLength(1)
    expect(screen.getAllByText('Concierge')).toHaveLength(1)
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
