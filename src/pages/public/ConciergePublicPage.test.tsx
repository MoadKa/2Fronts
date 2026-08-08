import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import i18n from '../../i18n'
import { buildConsentNotice, CONSENT_NOTICE_VERSION } from '../../lib/consent'
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
  //
  // Waits for the probe to SETTLE first (either way). The submit button is held
  // disabled until then, so that a visitor is never asked for their email on a
  // screen that could not yet offer them the follow-up consent choice. Callers
  // therefore have to give the probe a verdict — resolve or reject — before
  // using this; the suite's default "never settles" mock deliberately does not.
  async function passContactGate(opening: Record<string, unknown> = { reply: 'Danke, Max!', show_booking: false }) {
    sendConciergeMessage.mockResolvedValueOnce(opening)
    fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Deine E-Mail'), { target: { value: 'max@example.com' } })
    const submit = screen.getByRole('button', { name: "Los geht's" })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await screen.findByPlaceholderText('Nachricht eingeben…')
  }

  // A probe that lands, in German, naming a business — the ordinary case, and
  // the only one in which the consent box exists at all.
  const INTRO_DE = { language: 'de', business_name: 'Coach Meyer', is_demo: false }

  // Render with a probe that actually answers, and wait until it has. Most tests
  // here are about what happens AFTER the contact gate, and the gate now waits
  // for the probe, so they need a probe that finishes.
  async function renderSettled(slug = 'acme', intro: Record<string, unknown> = INTRO_DE) {
    fetchConciergeIntro.mockResolvedValue(intro)
    const rendered = renderAt(slug)
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeInTheDocument())
    return rendered
  }

  it('opens with the name/email form first (composer hidden until contact is given)', () => {
    renderAt('acme')
    // The welcome + contact form is the first thing shown; the composer is not yet.
    expect(screen.getByPlaceholderText('Dein Name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Deine E-Mail')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Nachricht eingeben…')).not.toBeInTheDocument()
  })

  it('submitting the contact form sends the contact and renders the opening reply', async () => {
    await renderSettled('acme')

    sendConciergeMessage.mockResolvedValueOnce({ reply: 'Danke, Max! Erzähl mir kurz, worum es geht.', show_booking: false })
    fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Deine E-Mail'), { target: { value: 'max@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: "Los geht's" }))

    // The contact is sent as the 6th arg; name carried as the message. No
    // `consent` key: the box was there and was left untouched.
    expect(sendConciergeMessage).toHaveBeenCalledWith('acme', 'sess-test', 'Max', undefined, undefined, {
      name: 'Max',
      email: 'max@example.com',
    })
    // The opening reply renders and the composer takes over.
    await waitFor(() => expect(screen.getByText('Danke, Max! Erzähl mir kurz, worum es geht.')).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Nachricht eingeben…')).toBeInTheDocument()
  })

  it('sends a message and renders the AI reply', async () => {
    await renderSettled('acme')
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
    await renderSettled('acme')
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
    await renderSettled('acme')
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
    await renderSettled('acme')
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
    await renderSettled('acme')
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
    await renderSettled('acme')

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

  it('links the Datenschutzerklärung and the Impressum from every concierge page', () => {
    // The follow-up consent notice on this page points a visitor at the
    // Datenschutzerklärung. Art. 13 DSGVO makes that a promise the page has to
    // keep: without a link, the consent is not informed, however well the
    // evidence is stored. Both links open in a new tab so a visitor who reads
    // them does not lose the conversation.
    renderAt('acme')

    const privacy = screen.getByRole('link', { name: 'Datenschutzerklärung' })
    expect(privacy).toHaveAttribute('href', '/datenschutz')
    expect(privacy).toHaveAttribute('target', '_blank')
    const imprint = screen.getByRole('link', { name: 'Impressum' })
    expect(imprint).toHaveAttribute('href', '/impressum')
    expect(imprint).toHaveAttribute('target', '_blank')
  })

  it('keeps the legal links in the embedded widget too', () => {
    // The widget iframe on the coach's own site is exactly where a prospect
    // meets the consent box, so dropping the links there would drop them from
    // the audience that needs them.
    render(
      <MemoryRouter initialEntries={['/c/acme?embed=1']}>
        <Routes>
          <Route path="/c/:slug" element={<ConciergePublicPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Datenschutzerklärung' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Impressum' })).toBeInTheDocument()
  })

  it('labels the legal links in the CONCIERGE language', async () => {
    // The labels come from the legal pages' own titles through the
    // probe-pinned `t`, so an English concierge must not offer a German
    // visitor's browser its German wording.
    fetchConciergeIntro.mockResolvedValue({ language: 'en', business_name: 'Acme' })
    renderAt('acme')

    await waitFor(() => expect(screen.getByRole('link', { name: 'Privacy Policy' })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Imprint' })).toHaveAttribute('href', '/impressum')
    expect(screen.queryByRole('link', { name: 'Datenschutzerklärung' })).not.toBeInTheDocument()
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

  it('keeps /c/:slug out of search results', async () => {
    // A concierge is a per-visitor chat surface, not content — and a demo one is
    // a page on 2Fronts' domain speaking as a named real business. Both demos
    // that existed when this was added were indexable.
    fetchConciergeIntro.mockResolvedValue({ language: 'de', business_name: 'Acme', is_demo: false })
    renderAt('acme')

    await waitFor(() =>
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
        'noindex, follow',
      ),
    )
  })

  it('renders the demo disclosure when the concierge is a demo', async () => {
    // The prospect has to be able to see, on the page itself, that this was built
    // by 2Fronts rather than commissioned by the business it speaks for.
    // Fixture name is deliberately invented. This repository is public, and a
    // test asserting "<real person> is a sales demo" publishes a claim about
    // someone who never agreed to be one.
    fetchConciergeIntro.mockResolvedValue({
      language: 'de',
      business_name: 'Beispiel Coaching',
      is_demo: true,
    })
    renderAt('beispiel-coaching')

    await waitFor(() =>
      expect(screen.getByText(/Unverbindliche Demo von 2fronts\.de/)).toBeInTheDocument(),
    )
  })

  it('does NOT render the demo disclosure on a real customer concierge', async () => {
    // The inverse matters as much: stamping a paying coach's own setter with a
    // "this is a demo" notice would be worse than the exposure it prevents.
    fetchConciergeIntro.mockResolvedValue({ language: 'de', business_name: 'Acme', is_demo: false })
    renderAt('acme')

    await waitFor(() => expect(screen.getByPlaceholderText('Dein Name')).toBeInTheDocument())
    expect(screen.queryByText(/Unverbindliche Demo/)).not.toBeInTheDocument()
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
    await renderSettled('acme')
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

  it('paints the opening screen immediately while the probe is still in flight', async () => {
    // The probe is a network round trip on a public page. It must never gate the
    // first PAINT: the visitor sees the browser-language welcome + form at once,
    // and can already type. Only the act of handing over an email waits (see the
    // consent tests below) — the screen itself never does.
    fetchConciergeIntro.mockReturnValue(new Promise(() => {})) // never resolves

    const { unmount } = renderAt('acme')
    expect(screen.getByText(GREETING_DE)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Dein Name')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Max' } })
    expect(screen.getByPlaceholderText('Dein Name')).toHaveValue('Max')
    unmount()

    // …and the moment the probe lands, the form is complete and submittable.
    await renderSettled('acme')
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
    // (The probe answered fine here; the slug died between the probe and the send.)
    sendConciergeMessage.mockRejectedValue(new Error('conciergeChat.unavailable'))
    await renderSettled('nope')

    fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Deine E-Mail'), { target: { value: 'max@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: "Los geht's" }))

    await waitFor(() =>
      expect(screen.getByText('Diese Seite ist nicht verfügbar')).toBeInTheDocument(),
    )
  })

  // ---------------------------------------------------------------------------
  // Follow-up email consent (§7 Abs. 2 UWG / Art. 4 Nr. 11 DSGVO)
  //
  // The tick is optional, so almost every failure mode here is silent: a box
  // that was never shown, a box that was ticked by accident, a wording that
  // drifted from the one the server records. None of them break the page. Each
  // one destroys the evidence at exactly the moment someone challenges it.
  // ---------------------------------------------------------------------------

  const CONSENT_LABEL_DE = buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', 'Coach Meyer')!.label
  const CONSENT_NOTICE_DE = buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', 'Coach Meyer')!.notice

  // The contact object handed to the service on the opening submit.
  function submittedContact() {
    const call = sendConciergeMessage.mock.calls.at(-1)!
    return call[5] as Record<string, unknown>
  }

  it('renders no consent box and holds the submit shut until the probe has settled', () => {
    // contactMode starts true, so the form is usable on the very first paint —
    // while businessName and pageLang are still null and the checkbox therefore
    // cannot exist. Submitting in that window would hand over an email on a
    // screen that never offered the choice, which is not the same thing as
    // declining it. The button waits; the rest of the page does not.
    fetchConciergeIntro.mockReturnValue(new Promise(() => {})) // never settles
    renderAt('acme')

    fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Deine E-Mail'), { target: { value: 'max@example.com' } })

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Los geht's" })).toBeDisabled()
  })

  it('lets a visitor through with no consent box when the probe FAILS', async () => {
    // The inverse of the test above, and the one that matters more: "settled"
    // means answered, not answered well. A probe broken for every visitor (a
    // lagging edge-function deploy) must cost the checkbox and nothing else. If
    // this ever regressed, the contact form would be dead site-wide.
    fetchConciergeIntro.mockRejectedValue(new Error('conciergeChat.error'))
    renderAt('acme')

    fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Deine E-Mail'), { target: { value: 'max@example.com' } })

    const submit = screen.getByRole('button', { name: "Los geht's" })
    await waitFor(() => expect(submit).toBeEnabled())
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    sendConciergeMessage.mockResolvedValueOnce({ reply: 'Danke, Max!', show_booking: false })
    fireEvent.click(submit)
    await screen.findByPlaceholderText('Nachricht eingeben…')
    expect('consent' in submittedContact()).toBe(false)
  })

  it('renders the box unticked on first paint', async () => {
    // A pre-ticked box is not a consent (Art. 4 Nr. 11 DSGVO, Planet49). The
    // state is initialised false and nothing may ever seed it.
    await renderSettled('acme')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('sends the exact three-field consent claim when the box is ticked', async () => {
    await renderSettled('acme')

    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('checkbox')).toBeChecked()

    sendConciergeMessage.mockResolvedValueOnce({ reply: 'Danke, Max!', show_booking: false })
    fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Deine E-Mail'), { target: { value: 'max@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: "Los geht's" }))
    await screen.findByPlaceholderText('Nachricht eingeben…')

    // Exactly these three fields, exactly these names. The server rebuilds the
    // wording from them and refuses the row if its render disagrees.
    expect(submittedContact()).toEqual({
      name: 'Max',
      email: 'max@example.com',
      consent: {
        notice_version: CONSENT_NOTICE_VERSION,
        locale: 'de',
        rendered_business_name: 'Coach Meyer',
      },
    })
  })

  it('sends NO consent key when the box is left unticked', async () => {
    // Absent, not present-and-falsy. An unticked box and a box that was never
    // rendered have to be indistinguishable on the wire, or the server ends up
    // holding a signal it can be tempted to store.
    await renderSettled('acme')

    sendConciergeMessage.mockResolvedValueOnce({ reply: 'Danke, Max!', show_booking: false })
    fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Deine E-Mail'), { target: { value: 'max@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: "Los geht's" }))
    await screen.findByPlaceholderText('Nachricht eingeben…')

    const contact = submittedContact()
    expect('consent' in contact).toBe(false)
    expect(contact).toEqual({ name: 'Max', email: 'max@example.com' })
  })

  it('does not gate the submit on the tick — consent is optional, not a toll', async () => {
    await renderSettled('acme')
    fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Deine E-Mail'), { target: { value: 'max@example.com' } })
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: "Los geht's" })).toBeEnabled()
  })

  it('ticks on a click on the short label, and NOT on a click on the notice', async () => {
    // The <label> wraps the input and the one-line label only. The five-sentence
    // notice is a sibling, associated by aria-describedby. If it were inside the
    // label, a visitor reading the explanation and clicking a word in it would
    // "consent" — and a tick collected by misclicking explanatory text is not a
    // tick anyone could defend.
    const { container } = await renderSettled('acme')
    const box = screen.getByRole('checkbox')

    const noticeEl = container.querySelector('.concierge-consent-notice')!
    expect(noticeEl).toBeInTheDocument()
    expect(noticeEl.closest('label')).toBeNull()
    fireEvent.click(noticeEl)
    expect(box).not.toBeChecked()

    fireEvent.click(screen.getByText(CONSENT_LABEL_DE))
    expect(box).toBeChecked()
  })

  it('describes the box with the notice rather than labelling it with it', async () => {
    const { container } = await renderSettled('acme')
    const box = screen.getByRole('checkbox')
    const noticeEl = container.querySelector('.concierge-consent-notice')!

    expect(box.getAttribute('aria-describedby')).toBe(noticeEl.id)
    expect(noticeEl.id).toBeTruthy()
    // The accessible NAME is the short line only — a screen reader announces the
    // commitment, then the explanation, not five sentences as the control's name.
    expect(box.closest('label')).toHaveTextContent(CONSENT_LABEL_DE)
    expect(box.closest('label')?.textContent).toBe(CONSENT_LABEL_DE)
  })

  it('renders the notice character for character, link and all', async () => {
    // THE wording lock on the render side. The notice is a locked string in
    // src/lib/consent.ts, mirrored byte for byte by the edge function, and the
    // server stores its own re-render as the evidence of what was on screen.
    // Splitting it in JSX to make one word a link must therefore change nothing
    // a reader sees. This assertion is what stops the next person "improving"
    // the wording through the markup and silently invalidating every consent
    // collected afterwards.
    const { container } = await renderSettled('acme')
    const noticeEl = container.querySelector('.concierge-consent-notice')!
    expect(noticeEl.textContent).toBe(CONSENT_NOTICE_DE)
  })

  it('makes the Datenschutzerklärung inside the notice a real link', async () => {
    // Art. 13 DSGVO: the notice promises "mehr dazu in der Datenschutzerklärung".
    // A promise a visitor cannot follow from where they are standing is not
    // information, and the consent built on it is not informed.
    const { container } = await renderSettled('acme')
    const link = container.querySelector('.concierge-consent-notice a')!

    expect(link).toHaveAttribute('href', '/datenschutz')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    // The linked word is lifted OUT of the locked string, never typed next to it.
    expect(CONSENT_NOTICE_DE).toContain(link.textContent!)
  })

  it('renders the consent in the CONCIERGE language and names the concierge', async () => {
    // Same rule as the rest of the chrome: the coach configured the language, the
    // AI answers in it, and a consent shown in a language the visitor was not
    // being spoken to in is not one they were given a fair chance to read.
    const english = buildConsentNotice(CONSENT_NOTICE_VERSION, 'en', 'Coach Meyer')!
    await renderSettled('acme', { language: 'en', business_name: 'Coach Meyer', is_demo: false })

    expect(screen.getByText(english.label)).toBeInTheDocument()
    expect(screen.queryByText(CONSENT_LABEL_DE)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox'))
    sendConciergeMessage.mockResolvedValueOnce({ reply: 'Thanks, Max!', show_booking: false })
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Your email'), { target: { value: 'max@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: "Let's go" }))
    await screen.findByPlaceholderText('Type your message…')

    expect(submittedContact().consent).toEqual({
      notice_version: CONSENT_NOTICE_VERSION,
      locale: 'en',
      rendered_business_name: 'Coach Meyer',
    })
  })

  it('renders no consent box for a concierge with no business name', async () => {
    // buildConsentNotice returns null and the page must render nothing rather
    // than a box promising an email from nobody. The rest of the page carries on.
    fetchConciergeIntro.mockResolvedValue({ language: 'de', business_name: '', is_demo: false })
    renderAt('acme')

    const submit = screen.getByRole('button', { name: "Los geht's" })
    fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Max' } })
    fireEvent.change(screen.getByPlaceholderText('Deine E-Mail'), { target: { value: 'max@example.com' } })
    await waitFor(() => expect(submit).toBeEnabled())
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // "Just looking for now"
  //
  // The consent notice tells the visitor the tick is voluntary and that they can
  // keep chatting without it. That is only true if the ADDRESS is optional too.
  // A voluntary checkbox sitting on a compulsory email is a Kopplung, and if the
  // collection itself is unlawful then the consent to mail it is worth nothing.
  // So this escape hatch protects every row in the consent ledger.
  // -------------------------------------------------------------------------
  describe('leaving the contact form without an address', () => {
    it('offers a visible way past the form, even before the probe settles', () => {
      renderAt('acme')
      // Deliberately NOT gated on probeSettled: a visitor who does not want to
      // give an address must not be held by a network call.
      expect(screen.getByRole('button', { name: 'Erst mal nur schauen' })).toBeInTheDocument()
    })

    it('sends the skip control and never sends a contact', async () => {
      await renderSettled('acme')
      sendConciergeMessage.mockResolvedValueOnce({
        reply: 'Klar, frag einfach. Hast du Fragen, bevor wir loslegen?',
        show_booking: false,
      })
      fireEvent.click(screen.getByRole('button', { name: 'Erst mal nur schauen' }))

      await waitFor(() => expect(sendConciergeMessage).toHaveBeenCalled())
      const args = sendConciergeMessage.mock.calls.at(-1)!
      // (slug, sessionId, message, answer, pendingCriterionId, contact)
      expect(args[3]).toEqual({
        criterion_id: '__skip_contact__',
        label: 'Erst mal nur schauen',
        qualifies: false,
      })
      // The sixth argument is the contact. There must not be one.
      expect(args[5]).toBeUndefined()
    })

    it('drops the visitor into the normal composer afterwards', async () => {
      await renderSettled('acme')
      sendConciergeMessage.mockResolvedValueOnce({
        reply: 'Klar, frag einfach.',
        show_booking: false,
      })
      fireEvent.click(screen.getByRole('button', { name: 'Erst mal nur schauen' }))
      await waitFor(() =>
        expect(screen.getByPlaceholderText('Nachricht eingeben…')).toBeInTheDocument(),
      )
      // And the form, with its consent box, is gone rather than re-asking.
      expect(screen.queryByPlaceholderText('Deine E-Mail')).not.toBeInTheDocument()
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })

    it('is not the primary action: submit is still the button that carries the form', async () => {
      await renderSettled('acme')
      const skip = screen.getByRole('button', { name: 'Erst mal nur schauen' })
      const submit = screen.getByRole('button', { name: "Los geht's" })
      expect(skip).not.toHaveAttribute('type', 'submit')
      expect(submit).toHaveAttribute('type', 'submit')
    })
  })
})
