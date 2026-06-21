import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CatalogPage } from './CatalogPage'
import { listActiveAutomations } from '../../services/AutomationService'

vi.mock('../../services/AutomationService', () => ({ listActiveAutomations: vi.fn() }))

describe('CatalogPage', () => {
  it('renders each active automation with name, category, and price', async () => {
    vi.mocked(listActiveAutomations).mockResolvedValue([
      { id: 'auto-1', name: 'Invoice Sync', summary: 'Syncs invoices', outcome_description: 'x', category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, requires_provisioning: false, created_at: '2026-06-01T00:00:00Z' },
    ])
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Invoice Sync')).toBeInTheDocument())
    expect(screen.getByText('finance')).toBeInTheDocument()
  })

  it('shows an empty state when there are no automations', async () => {
    vi.mocked(listActiveAutomations).mockResolvedValue([])
    render(<MemoryRouter><CatalogPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('No automations available yet.')).toBeInTheDocument())
  })
})
