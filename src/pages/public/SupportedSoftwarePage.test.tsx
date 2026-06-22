import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SupportedSoftwarePage } from './SupportedSoftwarePage'
import { listPublicConnectors } from '../../services/ConnectorService'

vi.mock('../../services/ConnectorService', () => ({ listPublicConnectors: vi.fn() }))

const live = {
  connector_type: 'google_sheets', display_name: 'Google Sheets', category: 'Tabellen & Leads',
  status: 'live' as const, is_public: true, sort_order: 10, created_at: '2026-06-21T00:00:00Z',
}
const soon = {
  connector_type: 'hubspot', display_name: 'HubSpot', category: 'CRM',
  status: 'coming_soon' as const, is_public: true, sort_order: 20, created_at: '2026-06-21T00:00:00Z',
}

describe('SupportedSoftwarePage', () => {
  it('renders live connectors as available and coming-soon as dimmed "Bald"', async () => {
    vi.mocked(listPublicConnectors).mockResolvedValue([live, soon])
    render(<MemoryRouter><SupportedSoftwarePage /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText('Google Sheets')).toBeInTheDocument())
    expect(screen.getByText(/Verfügbar/)).toBeInTheDocument()
    expect(screen.getByText('Bald')).toBeInTheDocument()
    // The coming-soon card carries the dimming class, never a dead link (D6).
    expect(screen.getByText('HubSpot').closest('.software-card')).toHaveClass('software-card-soon')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows an empty state when no connectors are public', async () => {
    vi.mocked(listPublicConnectors).mockResolvedValue([])
    render(<MemoryRouter><SupportedSoftwarePage /></MemoryRouter>)
    await waitFor(() =>
      expect(screen.getByText('Es sind noch keine Anbindungen verfügbar.')).toBeInTheDocument(),
    )
  })

  it('shows an error state when the registry cannot be loaded', async () => {
    vi.mocked(listPublicConnectors).mockRejectedValue(new Error('network'))
    render(<MemoryRouter><SupportedSoftwarePage /></MemoryRouter>)
    await waitFor(() =>
      expect(screen.getByText(/konnte nicht geladen werden/)).toBeInTheDocument(),
    )
  })
})
