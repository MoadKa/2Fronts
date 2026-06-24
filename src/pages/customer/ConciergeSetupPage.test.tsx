import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ConciergeSetupPage } from './ConciergeSetupPage'

const createConcierge = vi.fn()
const linkProvisionToConcierge = vi.fn()
vi.mock('../../services/ConciergeService', () => ({
  createConcierge: (...a: unknown[]) => createConcierge(...a),
  linkProvisionToConcierge: (...a: unknown[]) => linkProvisionToConcierge(...a),
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/connect/prov-1/confirm']}>
      <Routes>
        <Route path="/connect/:provisionId/confirm" element={<ConciergeSetupPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// Fill every required field with a valid value.
function fillValid() {
  fireEvent.change(screen.getByLabelText('Firmenname'), { target: { value: 'Acme' } })
  fireEvent.change(screen.getByLabelText('Was du anbietest'), { target: { value: 'A program' } })
  fireEvent.change(screen.getByLabelText('Dein Buchungslink (Calendly / Cal.com)'), {
    target: { value: 'https://cal.com/acme' },
  })
  fireEvent.change(screen.getByLabelText('Dein Link-Name'), { target: { value: 'acme' } })
}

describe('ConciergeSetupPage', () => {
  beforeEach(() => {
    createConcierge.mockReset()
    linkProvisionToConcierge.mockReset()
  })

  it('renders the setup form', () => {
    renderPage()
    expect(screen.getByText('Richte deinen KI-Buchungs-Concierge ein')).toBeInTheDocument()
  })

  it('creates the concierge, links the provision, and shows the live link', async () => {
    createConcierge.mockResolvedValue({ id: 'con-1', slug: 'acme' })
    linkProvisionToConcierge.mockResolvedValue(undefined)
    renderPage()
    fillValid()
    fireEvent.click(screen.getByText('Concierge erstellen'))

    await waitFor(() => expect(screen.getByText('Dein Concierge ist live!')).toBeInTheDocument())
    // The live link points at /c/<slug>.
    const link = screen.getByText('/c/acme', { exact: false }).closest('a') ?? screen.getByRole('link', { name: /acme/i })
    expect(link.getAttribute('href')).toContain('/c/acme')

    expect(createConcierge).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'acme', business_name: 'Acme', calendar_url: 'https://cal.com/acme' }),
    )
    expect(linkProvisionToConcierge).toHaveBeenCalledWith('prov-1', 'con-1')
  })

  it('rejects an invalid slug before calling the service', async () => {
    renderPage()
    fillValid()
    fireEvent.change(screen.getByLabelText('Dein Link-Name'), { target: { value: 'Bad Slug!' } })
    fireEvent.click(screen.getByText('Concierge erstellen'))

    await waitFor(() =>
      expect(screen.getByText('Nur Kleinbuchstaben, Zahlen und Bindestriche.')).toBeInTheDocument(),
    )
    expect(createConcierge).not.toHaveBeenCalled()
  })

  it('surfaces a duplicate-slug error from the service', async () => {
    createConcierge.mockRejectedValue(new Error('conciergeSetup.slugTaken'))
    renderPage()
    fillValid()
    fireEvent.click(screen.getByText('Concierge erstellen'))

    await waitFor(() =>
      expect(
        screen.getByText('Dieser Link-Name ist bereits vergeben — bitte wähle einen anderen.'),
      ).toBeInTheDocument(),
    )
  })

  it('still shows success when linking the provision fails (concierge already works)', async () => {
    createConcierge.mockResolvedValue({ id: 'con-1', slug: 'acme' })
    linkProvisionToConcierge.mockRejectedValue(new Error('conciergeSetup.saveFailed'))
    renderPage()
    fillValid()
    fireEvent.click(screen.getByText('Concierge erstellen'))

    await waitFor(() => expect(screen.getByText('Dein Concierge ist live!')).toBeInTheDocument())
  })
})
