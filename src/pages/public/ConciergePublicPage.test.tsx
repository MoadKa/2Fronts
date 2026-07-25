import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import i18n from '../../i18n'
import { ConciergePublicPage } from './ConciergePublicPage'

// The opening welcome bubble, in both languages. It moved out of `messages`
// state into a render-time derivation so it can re-render in the coach's
// language once the probe lands — so it is worth asserting literally.
const GREETING_DE =
  'Hi, schön dass du da bist. Lass mir kurz deinen Namen und deine E-Mail da, dann lege ich für dich los.'
const GREETING_EN = "Hi, great to have you here. Drop your name and email and I'll get started for you."

const sendConciergeMessage = vi.fn()
const fetchConciergeIntro = vi.fn()
vi.mock('../../services/ConciergeService', () => ({
  sendConciergeMessage: (...args: unknown[]) => sendConciergeMessage(...args),
  fetchConciergeIntro: (...args: unknown[]) => fetchConciergeIntro(...args),
  newSessionId: () => 'sess-test',
  // The page compares thrown messages against these sentinels. Mocking the whole
  // module means omitting them makes the comparisons undefined === string, and
  // the unavailable screen silently stops rendering.
  CONCIERGE_UNAVAILABLE: 'conciergeChat.unavailable',
  CONCIERGE_ERROR: 'conciergeChat.error',
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
    fetchConciergeIntro.mockReset()
    // Default: a probe that never settles. The opening screen must not depend on
    // it (it renders in the browser language until it lands), so the tests that
    // are not ABOUT the probe get no pending state update racing their
    // assertions. Tests that care set their own mock.
    fetchConciergeIntro.mockReturnValue(new Promise(() => {}))
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

  it('shows the 2fronts.de credit link in embed mode only', () => {
    render(
      <MemoryRouter initialEntries={['/c/acme?embed=1']}>
        <Routes>
          <Route path="/c/:slug" element={<ConciergePublicPage />} />
        </Routes>
      </MemoryRouter>,
    )
    const credit = screen.getByRole('link', { name: 'Setter von 2fronts.de' })
    expect(credit).toHaveAttribute('href', 'https://2fronts.de/?utm_source=widget&utm_medium=embed')
    expect(credit).toHaveAttribute('target', '_blank')
    expect(credit).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows no credit link on the standalone page (it already lives on 2fronts.de)', () => {
    renderAt('acme')
    expect(screen.queryByRole('link', { name: 'Setter von 2fronts.de' })).not.toBeInTheDocument()
  })

  it('renders the opening screen in the CONCIERGE language, not the browser language', async () => {
    // The AI always replies in the language the coach configured. The opening
    // screen used to follow the visitor's browser instead, so an English-browser
    // visitor met an English welcome + form in front of a German bot (and vice
    // versa). The probe pins the page to the coach's setting.
    fetchConciergeIntro.mockResolvedValue({ language: 'en', business_name: 'Acme' })
    renderAt('acme')

    // Test env runs i18n in German; the English concierge must still win.
    await waitFor(() => expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Your email')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Dein Name')).not.toBeInTheDocument()
  })

  it('keeps the chat usable when the language probe fails', async () => {
    // A transient probe failure must not block the visitor: the page falls back
    // to the browser language and the chat still works end to end.
    fetchConciergeIntro.mockRejectedValue(new Error('conciergeChat.error'))
    renderAt('acme')

    await passContactGate()
    expect(screen.getByPlaceholderText('Nachricht eingeben…')).toBeInTheDocument()
    expect(screen.queryByText('Diese Seite ist nicht verfügbar')).not.toBeInTheDocument()
  })

  it('shows the unavailable screen immediately when the probe reports an unknown slug', async () => {
    // A dead or paused link should say so on arrival, not after the visitor has
    // typed their name and email.
    fetchConciergeIntro.mockRejectedValue(new Error('conciergeChat.unavailable'))
    renderAt('nope')

    await waitFor(() => expect(screen.getByText('Diese Seite ist nicht verfügbar')).toBeInTheDocument())
    expect(screen.queryByPlaceholderText('Dein Name')).not.toBeInTheDocument()
  })

  it('renders the WELCOME BUBBLE itself in the concierge language', async () => {
    // The greeting is the first thing a visitor reads and the reason this fix
    // exists. It moved out of `messages` state (captured once, in the browser
    // language) into a render-time derivation, so it must actually follow the
    // probe — asserting only the form placeholders would miss a stale bubble.
    fetchConciergeIntro.mockResolvedValue({ language: 'en', business_name: 'Acme' })
    renderAt('acme')

    await waitFor(() => expect(screen.getByText(GREETING_EN)).toBeInTheDocument())
    expect(screen.queryByText(GREETING_DE)).not.toBeInTheDocument()
  })

  it('keeps the greeting first and shows it exactly once across a conversation', async () => {
    // Regression guard for moving the greeting out of state: it is now prepended
    // on every render, so a mistake here duplicates it per turn or lets a later
    // message jump ahead of it.
    renderAt('acme')
    await passContactGate({ reply: 'Danke, Max!', show_booking: false })

    sendConciergeMessage.mockResolvedValue({ reply: 'Es dauert 12 Wochen.', show_booking: false })
    fireEvent.change(screen.getByPlaceholderText('Nachricht eingeben…'), { target: { value: 'Wie lange?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))
    await waitFor(() => expect(screen.getByText('Es dauert 12 Wochen.')).toBeInTheDocument())

    // Exactly one greeting, and still the very first bubble in the transcript.
    expect(screen.getAllByText(GREETING_DE)).toHaveLength(1)
    const bubbles = document.querySelectorAll('.concierge-bubble')
    expect(bubbles[0]).toHaveTextContent(GREETING_DE)
    expect(bubbles[bubbles.length - 1]).toHaveTextContent('Es dauert 12 Wochen.')
  })

  it('sets the document language to the concierge language and restores it on unmount', async () => {
    // Screen readers pronounce the chat from <html lang>. The page is a route in
    // a single-document SPA, so it must also hand the attribute back on unmount
    // rather than leaving the whole app claiming English.
    document.documentElement.lang = 'de'
    fetchConciergeIntro.mockResolvedValue({ language: 'en', business_name: 'Acme' })
    const { unmount } = renderAt('acme')

    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
    unmount()
    expect(document.documentElement.lang).toBe('de')
  })

  it('renders the error bubble in the concierge language, not the browser language', async () => {
    // handleSendError's message now goes through the probe-pinned `t`. It is the
    // one user-visible string whose language changed silently in this fix, so it
    // needs its own assertion.
    fetchConciergeIntro.mockResolvedValue({ language: 'en', business_name: 'Acme' })
    renderAt('acme')
    await waitFor(() => expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument())

    sendConciergeMessage.mockResolvedValueOnce({ reply: 'Thanks, Max!', show_booking: false })
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Your email'), { target: { value: 'max@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: "Let's go" }))
    await screen.findByPlaceholderText('Type your message…')

    sendConciergeMessage.mockRejectedValueOnce(new Error('conciergeChat.error'))
    fireEvent.change(screen.getByPlaceholderText('Type your message…'), { target: { value: 'hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(screen.getByText('Something went wrong, please try again.')).toBeInTheDocument(),
    )
    expect(screen.queryByText('Etwas ist schiefgelaufen, bitte erneut versuchen.')).not.toBeInTheDocument()
  })

  it('falls back to the browser language when the probe answers in an unexpected shape', async () => {
    // Partial-deploy safety: the old edge function answers 200 in the CHAT shape.
    // The service rejects that rather than handing the page an object of
    // undefineds, so the opening screen must stay usable in the browser language.
    fetchConciergeIntro.mockRejectedValue(new Error('conciergeChat.error'))
    renderAt('acme')

    await waitFor(() => expect(fetchConciergeIntro).toHaveBeenCalled())
    expect(screen.getByText(GREETING_DE)).toBeInTheDocument()
    await passContactGate()
    expect(screen.getByPlaceholderText('Nachricht eingeben…')).toBeInTheDocument()
  })

  it('pins the document language even when the concierge matches the browser', async () => {
    // The page once skipped its own state update when the probe agreed with the
    // browser, as a re-render optimization — which also skipped the <html lang>
    // pin. An English visitor on an English concierge then read English text out
    // of a document still declaring index.html's "de". The probe result is now
    // always recorded, so the attribute is correct in every combination.
    document.documentElement.lang = 'de'
    fetchConciergeIntro.mockResolvedValue({ language: 'en', business_name: 'Acme' })
    // Browser and concierge agree on English; only the document disagrees.
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    try {
      const { unmount } = renderAt('acme')
      await waitFor(() => expect(document.documentElement.lang).toBe('en'))
      unmount()
      expect(document.documentElement.lang).toBe('de')
    } finally {
      await act(async () => {
        await i18n.changeLanguage('de')
      })
    }
  })

  it('names the browser tab after the coach, and restores the title on unmount', async () => {
    // A prospect usually opens this link from a DM, among a dozen tabs. The
    // concierge's own name identifies it; the app's generic title does not.
    const previous = document.title
    fetchConciergeIntro.mockResolvedValue({ language: 'de', business_name: 'Roman Kmenta' })
    const { unmount } = renderAt('roman-kmenta')

    await waitFor(() => expect(document.title).toBe('Roman Kmenta'))
    unmount()
    expect(document.title).toBe(previous)
  })

  it('does not rename the host document in embed mode', async () => {
    // Embedded, the page is an iframe on the coach's site; its document title is
    // never shown, so touching it is pointless churn.
    const previous = document.title
    document.documentElement.lang = 'de'
    // English probe, so the language pin gives us a signal that the probe has
    // actually LANDED. Waiting only on the mock being called would assert the
    // title before the effect could ever run, and the test could never fail.
    fetchConciergeIntro.mockResolvedValue({ language: 'en', business_name: 'Roman Kmenta' })
    render(
      <MemoryRouter initialEntries={['/c/roman-kmenta?embed=1']}>
        <Routes>
          <Route path="/c/:slug" element={<ConciergePublicPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(document.documentElement.lang).toBe('en'))
    expect(document.title).toBe(previous)
  })

  it('renders a usable opening screen immediately while the probe is still in flight', async () => {
    // The probe is a network round trip on a public page. It must never gate the
    // first paint: the visitor sees the browser-language welcome + form at once,
    // and can complete the contact gate before the probe ever answers.
    fetchConciergeIntro.mockReturnValue(new Promise(() => {})) // never resolves

    renderAt('acme')
    expect(screen.getByText(GREETING_DE)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Dein Name')).toBeInTheDocument()

    await passContactGate()
    expect(screen.getByPlaceholderText('Nachricht eingeben…')).toBeInTheDocument()
  })

  it('ignores a probe that resolves after the page has moved to another concierge', async () => {
    // The effect's `cancelled` flag. /c/:slug keeps the same component instance
    // across a slug change, so a slow probe for the OLD slug can land after the
    // new one answered — and would otherwise repaint the page in the wrong
    // coach's language.
    let resolveStale: (v: { language: string; business_name: string }) => void = () => {}
    fetchConciergeIntro.mockImplementation((slug: string) =>
      slug === 'slow'
        ? new Promise((resolve) => {
            resolveStale = resolve
          })
        : Promise.resolve({ language: 'de', business_name: 'Fast' }),
    )

    function Harness() {
      const navigate = useNavigate()
      return (
        <>
          <ConciergePublicPage />
          <button type="button" onClick={() => navigate('/c/fast')}>
            switch
          </button>
        </>
      )
    }
    render(
      <MemoryRouter initialEntries={['/c/slow']}>
        <Routes>
          <Route path="/c/:slug" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'switch' }))
    await waitFor(() => expect(fetchConciergeIntro).toHaveBeenCalledWith('fast'))

    // The abandoned probe answers late, in a different language.
    await act(async () => {
      resolveStale({ language: 'en', business_name: 'Slow' })
    })

    expect(screen.getByPlaceholderText('Dein Name')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Your name')).not.toBeInTheDocument()
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
