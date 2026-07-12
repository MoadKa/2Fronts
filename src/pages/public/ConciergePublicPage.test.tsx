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

  // Submit the opening name/email form so the chat advances to the normal composer.
  // The opening reply (and any quick replies) come from the mocked first response.
  async function passContactGate(opening: Record<string, unknown> = { reply: 'Danke, Max!', show_booking: false }) {
    sendConciergeMessage.mockResolvedValueOnce(opening)
    fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Deine E-Mail'), { target: { value: 'max@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: "Los geht's" }))
    await screen.findByPlaceholderText('Nachricht eingeben…')
  }

  it('opens with the name/email form first (composer hidden until contact is given)', () => {
    renderAt('acme')
    // The welcome + contact form is the first thing shown; the composer is not yet.
    expect(screen.getByPlaceholderText('Dein Name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Deine E-Mail')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Nachricht eingeben…')).not.toBeInTheDocument()
  })

  it('submitting the contact form sends the contact and renders the opening reply', async () => {
    renderAt('acme')

    sendConciergeMessage.mockResolvedValueOnce({ reply: 'Danke, Max! Erzähl mir kurz, worum es geht.', show_booking: false })
    fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Deine E-Mail'), { target: { value: 'max@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: "Los geht's" }))

    // The contact is sent as the 6th arg; name carried as the message.
    expect(sendConciergeMessage).toHaveBeenCalledWith('acme', 'sess-test', 'Max', undefined, undefined, {
      name: 'Max',
      email: 'max@example.com',
    })
    // The opening reply renders and the composer takes over.
    await waitFor(() => expect(screen.getByText('Danke, Max! Erzähl mir kurz, worum es geht.')).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Nachricht eingeben…')).toBeInTheDocument()
  })

  it('sends a message and renders the AI reply', async () => {
    renderAt('acme')
    await passContactGate()

    sendConciergeMessage.mockResolvedValue({ reply: 'Es dauert 12 Wochen.', show_booking: false })
    fireEvent.change(screen.getByPlaceholderText('Nachricht eingeben…'), { target: { value: 'Wie lange?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))

    // The visitor's own message renders immediately.
    expect(screen.getByText('Wie lange?')).toBeInTheDocument()
    // The reply renders once the service resolves.
    await waitFor(() => expect(screen.getByText('Es dauert 12 Wochen.')).toBeInTheDocument())
    // No quick-reply was pending, so no answer and no pending criterion id are sent.
    expect(sendConciergeMessage).toHaveBeenLastCalledWith('acme', 'sess-test', 'Wie lange?', undefined, undefined)
  })

  it('shows the booking CTA linking to the calendar when show_booking is true', async () => {
    renderAt('acme')
    await passContactGate()

    sendConciergeMessage.mockResolvedValue({
      reply: 'Buche hier!',
      show_booking: true,
      calendar_url: 'https://cal.com/acme',
    })
    fireEvent.change(screen.getByPlaceholderText('Nachricht eingeben…'), { target: { value: 'Termin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))

    const cta = await screen.findByText('Termin buchen')
    expect(cta.closest('a')).toHaveAttribute('href', 'https://cal.com/acme')
  })

  it('renders quick-reply buttons when the reply includes quick_replies', async () => {
    renderAt('acme')
    // The opening reply (after the contact gate) carries the first criterion's buttons.
    await passContactGate({
      reply: 'Danke, Max! Wie hoch ist dein Budget?',
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
    renderAt('acme')
    // The opening reply (after the contact gate) carries the first criterion's buttons.
    await passContactGate({
      reply: 'Danke, Max! Wie hoch ist dein Budget?',
      show_booking: false,
      quick_replies: {
        criterion_id: 'budget',
        question: 'Wie hoch ist dein Budget?',
        options: [{ label: '5k+', qualifies: true }],
      },
    })
    sendConciergeMessage.mockResolvedValueOnce({
      reply: 'Danke! Wann möchtest du starten?',
      show_booking: false,
      quick_replies: {
        criterion_id: 'timeline_role',
        question: 'Wann?',
        options: [{ label: 'Jetzt', qualifies: true }],
      },
    })
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
    renderAt('acme')
    // The opening reply (after the contact gate) carries the first criterion's buttons.
    await passContactGate({
      reply: 'Danke, Max! Budget?',
      show_booking: false,
      quick_replies: {
        criterion_id: 'budget',
        question: 'Budget?',
        options: [{ label: '5k+', qualifies: true }],
      },
    })
    sendConciergeMessage.mockResolvedValueOnce({
      reply: 'Danke!',
      show_booking: false,
      quick_replies: {
        criterion_id: 'timeline_role',
        question: 'Wann?',
        options: [{ label: 'Jetzt', qualifies: true }],
      },
    })

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

  it('submits the opening contact form and renders the opening reply', async () => {
    sendConciergeMessage.mockResolvedValueOnce({
      reply: 'Danke, Max Muster! Erzähl mir kurz, worum es geht.',
      show_booking: false,
    })
    renderAt('acme')

    // The name + email form is the FIRST thing shown (the composer is not yet).
    const nameInput = screen.getByPlaceholderText('Dein Name')
    const emailInput = screen.getByPlaceholderText('Deine E-Mail')
    expect(screen.queryByPlaceholderText('Nachricht eingeben…')).not.toBeInTheDocument()
    fireEvent.change(nameInput, { target: { value: 'Max Muster' } })
    fireEvent.change(emailInput, { target: { value: 'max@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: "Los geht's" }))

    // Submitted as the contact (6th arg), name carried as the message.
    expect(sendConciergeMessage).toHaveBeenLastCalledWith('acme', 'sess-test', 'Max Muster', undefined, undefined, {
      name: 'Max Muster',
      email: 'max@example.com',
    })
    // The opening reply renders and the composer takes over.
    await waitFor(() =>
      expect(screen.getByText('Danke, Max Muster! Erzähl mir kurz, worum es geht.')).toBeInTheDocument(),
    )
    expect(screen.getByPlaceholderText('Nachricht eingeben…')).toBeInTheDocument()
  })

  it('switches to embed mode when opened with ?embed=1 (widget iframe)', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/c/acme?embed=1']}>
        <Routes>
          <Route path="/c/:slug" element={<ConciergePublicPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(container.querySelector('.concierge-wrap')).toHaveClass('concierge-wrap--embed')
  })

  it('forwards Escape to the parent window in embed mode (cross-origin iframe bridge)', () => {
    // A cross-origin iframe never receives the host page's own keydown listener,
    // so embed.js can't catch Escape directly — this page posts it to the parent
    // instead; embed.js listens for this exact message shape and closes the panel.
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    render(
      <MemoryRouter initialEntries={['/c/acme?embed=1']}>
        <Routes>
          <Route path="/c/:slug" element={<ConciergePublicPage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(postMessage).toHaveBeenCalledWith({ source: 'tf-embed', type: 'escape' }, '*')
    postMessage.mockRestore()
  })

  it('does not forward Escape when not in embed mode', () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    renderAt('acme')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(postMessage).not.toHaveBeenCalled()
    postMessage.mockRestore()
  })

  it('stays in normal page mode without ?embed=1', () => {
    const { container } = renderAt('acme')
    const wrap = container.querySelector('.concierge-wrap')
    expect(wrap).toBeInTheDocument()
    expect(wrap).not.toHaveClass('concierge-wrap--embed')
  })

  it('shows a friendly unavailable screen when the slug is not found', async () => {
    // The contact form is the first step, and it is where the unavailable slug surfaces.
    sendConciergeMessage.mockRejectedValue(new Error('conciergeChat.unavailable'))
    renderAt('nope')

    fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Deine E-Mail'), { target: { value: 'max@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: "Los geht's" }))

    await waitFor(() =>
      expect(screen.getByText('Diese Seite ist nicht verfügbar')).toBeInTheDocument(),
    )
  })
})
