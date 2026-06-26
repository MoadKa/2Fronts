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
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))

    // The visitor's own message renders immediately.
    expect(screen.getByText('Wie lange?')).toBeInTheDocument()
    // The reply renders once the service resolves.
    await waitFor(() => expect(screen.getByText('Es dauert 12 Wochen.')).toBeInTheDocument())
    // No quick-reply was pending, so no answer and no pending criterion id are sent.
    expect(sendConciergeMessage).toHaveBeenCalledWith('acme', 'sess-test', 'Wie lange?', undefined, undefined)
  })

  it('shows the booking CTA linking to the calendar when show_booking is true', async () => {
    sendConciergeMessage.mockResolvedValue({
      reply: 'Buche hier!',
      show_booking: true,
      calendar_url: 'https://cal.com/acme',
    })
    renderAt('acme')

    fireEvent.change(screen.getByPlaceholderText('Nachricht eingeben…'), { target: { value: 'Termin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))

    const cta = await screen.findByText('Termin buchen')
    expect(cta.closest('a')).toHaveAttribute('href', 'https://cal.com/acme')
  })

  it('renders quick-reply buttons when the reply includes quick_replies', async () => {
    sendConciergeMessage.mockResolvedValue({
      reply: 'Hallo!',
      show_booking: false,
      quick_replies: {
        criterion_id: 'budget',
        question: 'Wie hoch ist dein Budget?',
        options: [
          { label: '5k+', qualifies: true },
          { label: '<1k', qualifies: false },
        ],
      },
    })
    renderAt('acme')

    fireEvent.change(screen.getByPlaceholderText('Nachricht eingeben…'), { target: { value: 'Hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))

    // The bot asks the question in its own reply now; the options render as buttons,
    // with the question kept as the group's accessible label (no separate text label).
    await waitFor(() => expect(screen.getByRole('button', { name: '5k+' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '<1k' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Wie hoch ist dein Budget?' })).toBeInTheDocument()
  })

  it('typing a free-text answer while a quick-reply is pending sends the pending criterion id (v1.3 fix)', async () => {
    // Bug fix: when a quick-reply prompt is showing and the visitor TYPES instead
    // of clicking, the page must pass the pending criterion id so the server can
    // interpret the text — not silently drop it. The buttons are server-driven.
    sendConciergeMessage
      .mockResolvedValueOnce({
        reply: 'Wie hoch ist dein Budget?',
        show_booking: false,
        quick_replies: {
          criterion_id: 'budget',
          question: 'Wie hoch ist dein Budget?',
          options: [{ label: '5k+', qualifies: true }],
        },
      })
      .mockResolvedValueOnce({
        reply: 'Danke! Wann möchtest du starten?',
        show_booking: false,
        quick_replies: {
          criterion_id: 'timeline_role',
          question: 'Wann?',
          options: [{ label: 'Jetzt', qualifies: true }],
        },
      })
    renderAt('acme')

    fireEvent.change(screen.getByPlaceholderText('Nachricht eingeben…'), { target: { value: 'Hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))
    await screen.findByRole('button', { name: '5k+' })

    // Visitor TYPES the answer instead of tapping a button.
    fireEvent.change(screen.getByPlaceholderText('Nachricht eingeben…'), { target: { value: 'so around 8k' } })
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))

    // The pending criterion id is passed (4th arg answer undefined, 5th = id).
    expect(sendConciergeMessage).toHaveBeenLastCalledWith('acme', 'sess-test', 'so around 8k', undefined, 'budget')
    // Server response drives the buttons forward to the next criterion.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Jetzt' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '5k+' })).not.toBeInTheDocument()
  })

  it('clicking a quick-reply sends the answer, shows the label, and renders the next prompt', async () => {
    sendConciergeMessage
      .mockResolvedValueOnce({
        reply: 'Hallo!',
        show_booking: false,
        quick_replies: {
          criterion_id: 'budget',
          question: 'Budget?',
          options: [{ label: '5k+', qualifies: true }],
        },
      })
      .mockResolvedValueOnce({
        reply: 'Danke!',
        show_booking: false,
        quick_replies: {
          criterion_id: 'timeline_role',
          question: 'Wann?',
          options: [{ label: 'Jetzt', qualifies: true }],
        },
      })
    renderAt('acme')

    fireEvent.change(screen.getByPlaceholderText('Nachricht eingeben…'), { target: { value: 'Hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))

    const optionBtn = await screen.findByRole('button', { name: '5k+' })
    fireEvent.click(optionBtn)

    // The chosen label appears as a user bubble immediately.
    expect(screen.getByText('5k+')).toBeInTheDocument()
    // The answer was sent with the matching QualAnswer.
    expect(sendConciergeMessage).toHaveBeenLastCalledWith('acme', 'sess-test', '5k+', {
      criterion_id: 'budget',
      label: '5k+',
      qualifies: true,
    })
    // The next prompt renders (its options as buttons, question as group label).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Jetzt' })).toBeInTheDocument())
    expect(screen.getByRole('group', { name: 'Wann?' })).toBeInTheDocument()
    // The answered prompt's buttons are gone.
    expect(screen.queryByRole('button', { name: '5k+' })).not.toBeInTheDocument()
  })

  it('asks for name + email when the server requests contact, then submits it and shows booking', async () => {
    sendConciergeMessage
      .mockResolvedValueOnce({ reply: 'Wie heißt du?', show_booking: false, request_contact: true })
      .mockResolvedValueOnce({ reply: 'Buche hier!', show_booking: true, calendar_url: 'https://cal.com/acme' })
    renderAt('acme')

    fireEvent.change(screen.getByPlaceholderText('Nachricht eingeben…'), { target: { value: 'Hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))

    // The composer is swapped for the name + email form.
    const nameInput = await screen.findByPlaceholderText('Dein Name')
    const emailInput = screen.getByPlaceholderText('Deine E-Mail')
    fireEvent.change(nameInput, { target: { value: 'Max Muster' } })
    fireEvent.change(emailInput, { target: { value: 'max@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Weiter zum Termin' }))

    // Submitted as the contact (6th arg), name carried as the message.
    expect(sendConciergeMessage).toHaveBeenLastCalledWith('acme', 'sess-test', 'Max Muster', undefined, undefined, {
      name: 'Max Muster',
      email: 'max@example.com',
    })
    // Booking CTA appears after the contact is captured.
    const cta = await screen.findByText('Termin buchen')
    expect(cta.closest('a')).toHaveAttribute('href', 'https://cal.com/acme')
  })

  it('shows a friendly unavailable screen when the slug is not found', async () => {
    sendConciergeMessage.mockRejectedValue(new Error('conciergeChat.unavailable'))
    renderAt('nope')

    fireEvent.change(screen.getByPlaceholderText('Nachricht eingeben…'), { target: { value: 'hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))

    await waitFor(() =>
      expect(screen.getByText('Diese Seite ist nicht verfügbar')).toBeInTheDocument(),
    )
  })
})
