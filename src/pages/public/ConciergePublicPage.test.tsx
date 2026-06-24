import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ConciergePublicPage } from './ConciergePublicPage'

const sendConciergeMessage = vi.fn()
vi.mock('../../services/ConciergeService', () => ({
  sendConciergeMessage: (...args: unknown[]) => sendConciergeMessage(...args),
  newSessionId: () => 'sess-test',
}))

function renderAt(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/c/${slug}`]}>
      <Routes>
        <Route path="/c/:slug" element={<ConciergePublicPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ConciergePublicPage', () => {
  beforeEach(() => {
    sendConciergeMessage.mockReset()
  })

  it('shows the greeting and an input on first load', () => {
    renderAt('acme')
    expect(screen.getByPlaceholderText('Nachricht eingeben…')).toBeInTheDocument()
  })

  it('sends a message and renders the AI reply', async () => {
    sendConciergeMessage.mockResolvedValue({ reply: 'Es dauert 12 Wochen.', show_booking: false })
    renderAt('acme')

    fireEvent.change(screen.getByPlaceholderText('Nachricht eingeben…'), { target: { value: 'Wie lange?' } })
    fireEvent.click(screen.getByText('Senden'))

    // The visitor's own message renders immediately.
    expect(screen.getByText('Wie lange?')).toBeInTheDocument()
    // The reply renders once the service resolves.
    await waitFor(() => expect(screen.getByText('Es dauert 12 Wochen.')).toBeInTheDocument())
    expect(sendConciergeMessage).toHaveBeenCalledWith('acme', 'sess-test', 'Wie lange?')
  })

  it('shows the booking CTA linking to the calendar when show_booking is true', async () => {
    sendConciergeMessage.mockResolvedValue({
      reply: 'Buche hier!',
      show_booking: true,
      calendar_url: 'https://cal.com/acme',
    })
    renderAt('acme')

    fireEvent.change(screen.getByPlaceholderText('Nachricht eingeben…'), { target: { value: 'Termin' } })
    fireEvent.click(screen.getByText('Senden'))

    const cta = await screen.findByText('Termin buchen')
    expect(cta.closest('a')).toHaveAttribute('href', 'https://cal.com/acme')
  })

  it('shows a friendly unavailable screen when the slug is not found', async () => {
    sendConciergeMessage.mockRejectedValue(new Error('conciergeChat.unavailable'))
    renderAt('nope')

    fireEvent.change(screen.getByPlaceholderText('Nachricht eingeben…'), { target: { value: 'hi' } })
    fireEvent.click(screen.getByText('Senden'))

    await waitFor(() =>
      expect(screen.getByText('Diese Seite ist nicht verfügbar')).toBeInTheDocument(),
    )
  })
})
