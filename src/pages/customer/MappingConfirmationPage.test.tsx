import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MappingConfirmationPage } from './MappingConfirmationPage'
import { getProposedMapping, saveConfirmedMapping } from '../../services/MappingService'
import { configureSheet } from '../../services/ConnectorService'
import type { ProposedMapping } from '../../types/database'

vi.mock('../../services/MappingService', () => ({
  getProposedMapping: vi.fn(),
  saveConfirmedMapping: vi.fn(),
}))

vi.mock('../../services/ConnectorService', () => ({
  configureSheet: vi.fn(),
}))

const mapping: ProposedMapping = {
  connectorType: 'google_sheets',
  sheetTitle: 'Leads 2026',
  availableColumns: [
    { value: 'A', label: 'Spalte A · „Eingang"' },
    { value: 'B', label: 'Spalte B · „Kundenname"' },
    { value: 'C', label: 'Spalte C · „Quelle"' },
    { value: 'D', label: 'Spalte D · „Tel."' },
  ],
  sampleLead: { name: 'Anna Weber', phone: '0176 1234567' },
  fields: [
    { field: 'name', label: 'Name', column: 'B', columnLabel: 'Spalte B · „Kundenname"', confidence: 'high' },
    { field: 'phone', label: 'Telefon', column: 'D', columnLabel: 'Spalte D · „Tel."', confidence: 'high' },
    { field: 'source', label: 'Quelle', column: null, columnLabel: null, confidence: 'low' },
  ],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/connect/prov-1/confirm']}>
      <Routes>
        <Route path="/connect/:provisionId/confirm" element={<MappingConfirmationPage />} />
        <Route path="/my-requests" element={<div>My Requests</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MappingConfirmationPage', () => {
  beforeEach(() => {
    vi.mocked(getProposedMapping).mockResolvedValue(mapping)
    vi.mocked(saveConfirmedMapping).mockResolvedValue()
  })

  it('renders Sicher and Unsicher confidence pills', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('● Sicher')).toHaveLength(2))
    expect(screen.getByText('● Unsicher')).toBeInTheDocument()
  })

  it('shows the append-only reassurance line', async () => {
    renderPage()
    await waitFor(() =>
      expect(
        screen.getByText(/bestehenden Daten werden nie überschrieben oder gelöscht/i)
      ).toBeInTheDocument()
    )
  })

  it('shows a sample preview row', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Beispiel:')).toBeInTheDocument())
    expect(screen.getByText(/Anna Weber/)).toBeInTheDocument()
  })

  it('keeps confirm disabled until the low-confidence field is chosen, then enables it', async () => {
    renderPage()
    const confirm = await screen.findByRole('button', { name: /Passt, los geht's/i })
    expect(confirm).toBeDisabled()

    const dropdown = screen.getByLabelText(/Spalte für Quelle wählen/i)
    fireEvent.change(dropdown, { target: { value: 'C' } })

    expect(confirm).toBeEnabled()
  })

  it('saves the confirmed mapping on confirm', async () => {
    renderPage()
    const confirm = await screen.findByRole('button', { name: /Passt, los geht's/i })
    fireEvent.change(screen.getByLabelText(/Spalte für Quelle wählen/i), { target: { value: 'C' } })
    fireEvent.click(confirm)

    await waitFor(() => expect(saveConfirmedMapping).toHaveBeenCalledTimes(1))
    expect(saveConfirmedMapping).toHaveBeenCalledWith('prov-1', [
      { field: 'name', column: 'B' },
      { field: 'phone', column: 'D' },
      { field: 'source', column: 'C' },
    ])
  })

  it('shows the sheet picker when no mapping exists, then configures and shows the mapping', async () => {
    // No proposal yet -> the picker is shown instead of the empty dead-end.
    vi.mocked(getProposedMapping).mockResolvedValue(null)
    vi.mocked(configureSheet).mockResolvedValue(mapping)

    renderPage()

    const input = await screen.findByLabelText(/Google-Sheet-Link/i)
    fireEvent.change(input, { target: { value: 'https://docs.google.com/spreadsheets/d/abc/edit' } })
    fireEvent.click(screen.getByRole('button', { name: /Tabelle lesen/i }))

    // After configure resolves, the confirmation UI renders the proposed mapping.
    await waitFor(() => expect(screen.getByText(/Leads 2026/)).toBeInTheDocument())
    expect(configureSheet).toHaveBeenCalledWith('prov-1', 'https://docs.google.com/spreadsheets/d/abc/edit')
  })

  it('surfaces a configure error in the picker', async () => {
    vi.mocked(getProposedMapping).mockResolvedValue(null)
    vi.mocked(configureSheet).mockRejectedValue(new Error('Dieser Link sieht nicht wie ein Google-Sheet aus.'))

    renderPage()
    const input = await screen.findByLabelText(/Google-Sheet-Link/i)
    fireEvent.change(input, { target: { value: 'nonsense' } })
    fireEvent.click(screen.getByRole('button', { name: /Tabelle lesen/i }))

    await waitFor(() => expect(screen.getByText(/Google-Sheet aus/)).toBeInTheDocument())
  })
})
