import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AutomationDetailPage } from './AutomationDetailPage'
import { getAutomationById } from '../../services/AutomationService'

vi.mock('../../services/AutomationService', () => ({ getAutomationById: vi.fn() }))

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/automations/${id}`]}>
      <Routes>
        <Route path="/automations/:id" element={<AutomationDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AutomationDetailPage', () => {
  it('renders the outcome description for a found automation', async () => {
    vi.mocked(getAutomationById).mockResolvedValue({
      id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'Saves 5 hours/week',
      category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z',
    })
    renderAt('auto-1')
    await waitFor(() => expect(screen.getByText('Saves 5 hours/week')).toBeInTheDocument())
  })

  it('shows a not-found message when the automation does not exist', async () => {
    vi.mocked(getAutomationById).mockResolvedValue(null)
    renderAt('missing')
    await waitFor(() => expect(screen.getByText('Automation not found.')).toBeInTheDocument())
  })
})
