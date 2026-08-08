import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import i18n from '../../i18n'
import { ConciergeSetupPage } from './ConciergeSetupPage'

const createConcierge = vi.fn()
const linkProvisionToConcierge = vi.fn()
const draftConciergeFromUrl = vi.fn()
const saveFollowupSender = vi.fn()
vi.mock('../../services/ConciergeService', () => ({
  createConcierge: (...a: unknown[]) => createConcierge(...a),
  linkProvisionToConcierge: (...a: unknown[]) => linkProvisionToConcierge(...a),
  draftConciergeFromUrl: (...a: unknown[]) => draftConciergeFromUrl(...a),
  saveFollowupSender: (...a: unknown[]) => saveFollowupSender(...a),
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

// Drive the wizard from the welcome screen to the finish, filling each step.
// `lang` chooses which language toggle to click on the welcome screen.
function completeWizard(lang: 'de' | 'en') {
  // Welcome: pick language, start.
  const welcomeStart = lang === 'de' ? "Los geht's" : "Let's go"
  const langLabel =
    lang === 'de'
      ? i18n.getFixedT('de')('conciergeOnboarding.welcome.languageDe')
      : i18n.getFixedT('en')('conciergeOnboarding.welcome.languageEn')
  // The visible language buttons are labelled by their own language name.
  fireEvent.click(screen.getByRole('button', { name: langLabel }))
  fireEvent.click(screen.getByText(welcomeStart))

  const T = i18n.getFixedT(lang)
  const next = () => fireEvent.click(screen.getByText(T('conciergeOnboarding.next')))

  // Step 1 business
  fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.business.title')), {
    target: { value: 'Acme Coaching' },
  })
  next()
  // Step 2 offer
  fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.offer.title')), {
    target: { value: 'We coach founders.' },
  })
  next()
  // Step 3 questions (optional) -> skip
  next()
  // Step 4 booking
  fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.booking.label')), {
    target: { value: 'https://cal.com/acme' },
  })
  next()
  // Step 5 qualify (optional) -> skip
  next()
  // Step 6 tone -> finish
  fireEvent.click(screen.getByText(T('conciergeOnboarding.tone.finish')))
}

describe('ConciergeSetupPage onboarding wizard', () => {
  beforeEach(async () => {
    createConcierge.mockReset()
    linkProvisionToConcierge.mockReset()
    draftConciergeFromUrl.mockReset()
    saveFollowupSender.mockReset()
    await i18n.changeLanguage('de')
  })

  it('shows the welcome screen first', () => {
    renderPage()
    expect(
      screen.getByText(i18n.getFixedT('de')('conciergeOnboarding.welcome.title')),
    ).toBeInTheDocument()
  })

  it('renders a progress bar on a content step', () => {
    renderPage()
    fireEvent.click(screen.getByText("Los geht's"))
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    // Step 1 of 6.
    expect(screen.getByText('Schritt 1 von 6')).toBeInTheDocument()
  })

  it('validates a required step before advancing', () => {
    renderPage()
    fireEvent.click(screen.getByText("Los geht's"))
    fireEvent.click(screen.getByText('Weiter')) // business empty
    expect(
      screen.getByText(i18n.getFixedT('de')('conciergeOnboarding.errors.required')),
    ).toBeInTheDocument()
    expect(createConcierge).not.toHaveBeenCalled()
  })

  it('rejects an invalid booking URL with a clear message', () => {
    renderPage()
    fireEvent.click(screen.getByText("Los geht's"))
    const T = i18n.getFixedT('de')
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.business.title')), {
      target: { value: 'Acme' },
    })
    fireEvent.click(screen.getByText('Weiter'))
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.offer.title')), {
      target: { value: 'Offer' },
    })
    fireEvent.click(screen.getByText('Weiter'))
    fireEvent.click(screen.getByText('Weiter')) // skip questions
    // Regression: the booking prompt appears once (the heading) — it must NOT also be
    // the input label, which read as two booking-link fields.
    expect(screen.getAllByText(T('conciergeOnboarding.booking.title'))).toHaveLength(1)
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.booking.label')), {
      target: { value: 'not-a-url' },
    })
    fireEvent.click(screen.getByText('Weiter'))
    expect(screen.getByText(T('conciergeOnboarding.errors.invalidUrl'))).toBeInTheDocument()
  })

  it('back/next preserves entered data', () => {
    renderPage()
    fireEvent.click(screen.getByText("Los geht's"))
    const T = i18n.getFixedT('de')
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.business.title')), {
      target: { value: 'Acme Coaching' },
    })
    fireEvent.click(screen.getByText('Weiter')) // -> offer
    fireEvent.click(screen.getByText('Zurück')) // -> business
    expect(screen.getByLabelText(T('conciergeOnboarding.business.title'))).toHaveValue('Acme Coaching')
  })

  it('completes the full wizard in German and shows the live link', async () => {
    createConcierge.mockResolvedValue({ id: 'con-1', slug: 'acme-coaching' })
    linkProvisionToConcierge.mockResolvedValue(undefined)
    renderPage()
    completeWizard('de')

    await waitFor(() =>
      expect(
        screen.getByText(i18n.getFixedT('de')('conciergeOnboarding.done.title')),
      ).toBeInTheDocument(),
    )
    const link = screen.getByText('/c/acme-coaching', { exact: false }).closest('a')
    expect(link?.getAttribute('href')).toContain('/c/acme-coaching')

    expect(createConcierge).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'acme-coaching',
        business_name: 'Acme Coaching',
        calendar_url: 'https://cal.com/acme',
        language: 'de',
      }),
    )
    expect(linkProvisionToConcierge).toHaveBeenCalledWith('prov-1', 'con-1')
  })

  it('saves qualification_criteria when a builtin criterion is enabled', async () => {
    createConcierge.mockResolvedValue({ id: 'con-q', slug: 'acme-coaching' })
    linkProvisionToConcierge.mockResolvedValue(undefined)
    renderPage()
    const T = i18n.getFixedT('de')

    // Welcome -> business -> offer -> questions -> booking.
    fireEvent.click(screen.getByRole('button', { name: T('conciergeOnboarding.welcome.languageDe') }))
    fireEvent.click(screen.getByText("Los geht's"))
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.business.title')), {
      target: { value: 'Acme Coaching' },
    })
    fireEvent.click(screen.getByText('Weiter'))
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.offer.title')), {
      target: { value: 'We coach founders.' },
    })
    fireEvent.click(screen.getByText('Weiter'))
    fireEvent.click(screen.getByText('Weiter')) // skip questions
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.booking.label')), {
      target: { value: 'https://cal.com/acme' },
    })
    fireEvent.click(screen.getByText('Weiter')) // -> qualify

    // Enable the budget builtin criterion (toggle labelled by its question).
    const budgetToggle = screen.getByLabelText(T('conciergeOnboarding.qualify.presets.budgetQuestion'))
    fireEvent.click(budgetToggle)

    fireEvent.click(screen.getByText('Weiter')) // -> tone
    fireEvent.click(screen.getByText(T('conciergeOnboarding.tone.finish')))

    await waitFor(() => expect(createConcierge).toHaveBeenCalled())
    const arg = createConcierge.mock.calls[0][0]
    expect(arg.qualification_criteria).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'budget' })]),
    )
    expect(arg.qualification_criteria.length).toBeGreaterThan(0)
    expect(arg.qualification_criteria[0].options.length).toBeGreaterThan(0)
  })

  it('reorders qualification criteria via the move-up control and persists the new order', async () => {
    createConcierge.mockResolvedValue({ id: 'con-r', slug: 'acme-coaching' })
    linkProvisionToConcierge.mockResolvedValue(undefined)
    renderPage()
    const T = i18n.getFixedT('de')

    // Welcome -> business -> offer -> questions -> booking -> qualify.
    fireEvent.click(screen.getByRole('button', { name: T('conciergeOnboarding.welcome.languageDe') }))
    fireEvent.click(screen.getByText("Los geht's"))
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.business.title')), {
      target: { value: 'Acme Coaching' },
    })
    fireEvent.click(screen.getByText('Weiter'))
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.offer.title')), {
      target: { value: 'We coach founders.' },
    })
    fireEvent.click(screen.getByText('Weiter'))
    fireEvent.click(screen.getByText('Weiter')) // skip questions
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.booking.label')), {
      target: { value: 'https://cal.com/acme' },
    })
    fireEvent.click(screen.getByText('Weiter')) // -> qualify

    // Enable two builtins, in order: budget first, then age. The enabled cards
    // therefore render as [budget, age].
    const budgetQ = T('conciergeOnboarding.qualify.presets.budgetQuestion')
    const ageQ = T('conciergeOnboarding.qualify.presets.ageQuestion')
    fireEvent.click(screen.getByLabelText(budgetQ)) // enable budget (from chips)
    fireEvent.click(screen.getByLabelText(ageQ)) // enable age (from chips)

    // Move the SECOND criterion (age) up — order should become [age, budget].
    const moveAgeUp = screen.getByLabelText(`"${ageQ}" nach oben verschieben`)
    fireEvent.click(moveAgeUp)

    fireEvent.click(screen.getByText('Weiter')) // -> tone
    fireEvent.click(screen.getByText(T('conciergeOnboarding.tone.finish')))

    await waitFor(() => expect(createConcierge).toHaveBeenCalled())
    const arg = createConcierge.mock.calls[0][0]
    const ids = arg.qualification_criteria.map((c: { id: string }) => c.id)
    expect(ids).toEqual(['age', 'budget'])
  })

  it('completes the wizard in English and sets language=en on the concierge', async () => {
    createConcierge.mockResolvedValue({ id: 'con-2', slug: 'acme-coaching' })
    linkProvisionToConcierge.mockResolvedValue(undefined)
    await i18n.changeLanguage('en')
    renderPage()
    completeWizard('en')

    await waitFor(() =>
      expect(
        screen.getByText(i18n.getFixedT('en')('conciergeOnboarding.done.title')),
      ).toBeInTheDocument(),
    )
    expect(createConcierge).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }))
  })

  it('scrape accelerator prefills the offer, then the wizard completes', async () => {
    draftConciergeFromUrl.mockResolvedValue({
      offer_description: 'Drafted offer from site.',
      qa: 'Q? — A.',
      tone: 'professional',
      calendar_url: 'https://cal.com/drafted',
    })
    createConcierge.mockResolvedValue({ id: 'con-3', slug: 'acme-coaching' })
    linkProvisionToConcierge.mockResolvedValue(undefined)
    renderPage()
    const T = i18n.getFixedT('de')

    fireEvent.click(screen.getByRole('button', { name: T('conciergeOnboarding.welcome.languageDe') }))
    fireEvent.click(screen.getByText("Los geht's"))
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.business.title')), {
      target: { value: 'Acme Coaching' },
    })
    fireEvent.click(screen.getByText('Weiter')) // -> offer

    // Use the accelerator.
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.offer.scrapePrompt')), {
      target: { value: 'https://acme.com' },
    })
    fireEvent.click(screen.getByText(T('conciergeOnboarding.offer.scrapeButton')))

    await waitFor(() =>
      expect(screen.getByLabelText(T('conciergeOnboarding.offer.title'))).toHaveValue(
        'Drafted offer from site.',
      ),
    )
    expect(draftConciergeFromUrl).toHaveBeenCalledWith('https://acme.com', 'de')
  })

  it('scrape accelerator prefills the drafted qualifying questions too', async () => {
    // The coach used to hand-build these while every other field arrived filled
    // in. They travel a different path from the text fields (they are structured
    // objects, not strings), so a wiring mistake drops them silently and the
    // wizard just looks like it never drafted any.
    draftConciergeFromUrl.mockResolvedValue({
      offer_description: 'Drafted offer from site.',
      // The booking step needs a calendar URL before it will advance, and this
      // test walks all the way through to the qualify step.
      calendar_url: 'https://cal.com/drafted',
      qualification_criteria: [
        {
          id: 'budget',
          question: 'Wie hoch ist dein Budget?',
          options: [
            { label: '5k+', qualifies: true },
            { label: 'unter 1k', qualifies: false },
          ],
        },
      ],
    })
    renderPage()
    const T = i18n.getFixedT('de')

    fireEvent.click(screen.getByRole('button', { name: T('conciergeOnboarding.welcome.languageDe') }))
    fireEvent.click(screen.getByText("Los geht's"))
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.business.title')), {
      target: { value: 'Acme Coaching' },
    })
    fireEvent.click(screen.getByText('Weiter'))

    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.offer.scrapePrompt')), {
      target: { value: 'https://acme.com' },
    })
    fireEvent.click(screen.getByText(T('conciergeOnboarding.offer.scrapeButton')))

    await waitFor(() =>
      expect(screen.getByLabelText(T('conciergeOnboarding.offer.title'))).toHaveValue(
        'Drafted offer from site.',
      ),
    )
    // Walk on to the qualify step and confirm the drafted question is sitting
    // there, editable, exactly where the coach would otherwise have typed it.
    // (WIZARD_STEPS: offer -> questions -> booking -> qualify. "questions" is
    // the FAQ step; "qualify" is the one that holds the criteria.)
    fireEvent.click(screen.getByText('Weiter')) // -> questions
    fireEvent.click(screen.getByText('Weiter')) // -> booking
    fireEvent.click(screen.getByText('Weiter')) // -> qualify
    await waitFor(() =>
      expect(screen.getByDisplayValue('Wie hoch ist dein Budget?')).toBeInTheDocument(),
    )
  })

  it('treats a draft with ONLY qualifying questions as content, not a failure', async () => {
    // A page can yield usable qualifying criteria while the offer text comes back
    // empty. Judging "did the scrape work?" on the text fields alone would throw
    // that away and show the manual-fallback note.
    draftConciergeFromUrl.mockResolvedValue({
      qualification_criteria: [
        {
          id: 'industry',
          question: 'In welcher Branche bist du?',
          options: [
            { label: 'Coaching', qualifies: true },
            { label: 'Andere', qualifies: false },
          ],
        },
      ],
    })
    renderPage()
    const T = i18n.getFixedT('de')

    fireEvent.click(screen.getByRole('button', { name: T('conciergeOnboarding.welcome.languageDe') }))
    fireEvent.click(screen.getByText("Los geht's"))
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.business.title')), {
      target: { value: 'Acme Coaching' },
    })
    fireEvent.click(screen.getByText('Weiter'))
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.offer.scrapePrompt')), {
      target: { value: 'https://acme.com' },
    })
    fireEvent.click(screen.getByText(T('conciergeOnboarding.offer.scrapeButton')))

    await waitFor(() =>
      expect(screen.queryByText(T('conciergeOnboarding.offer.scrapeFailed'))).not.toBeInTheDocument(),
    )
  })

  it('treats an empty draft as a failure (no fake "done" with blank fields)', async () => {
    // A 200 with nothing usable (e.g. a JS-shell page) must NOT show success and
    // prefill nothing — the coach should get the honest manual-fallback note.
    draftConciergeFromUrl.mockResolvedValue({})
    renderPage()
    const T = i18n.getFixedT('de')

    fireEvent.click(screen.getByText("Los geht's"))
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.business.title')), {
      target: { value: 'Acme' },
    })
    fireEvent.click(screen.getByText('Weiter')) // -> offer

    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.offer.scrapePrompt')), {
      target: { value: 'https://acme.com' },
    })
    fireEvent.click(screen.getByText(T('conciergeOnboarding.offer.scrapeButton')))

    await waitFor(() =>
      expect(screen.getByText(T('conciergeOnboarding.offer.scrapeFailed'))).toBeInTheDocument(),
    )
    // The "done" hint must NOT appear.
    expect(screen.queryByText(T('conciergeOnboarding.offer.scrapeDone'))).not.toBeInTheDocument()
  })

  it('falls back to manual entry when the scrape fails (no error wall)', async () => {
    draftConciergeFromUrl.mockRejectedValue(new Error('conciergeOnboarding.errors.scrapeFailed'))
    renderPage()
    const T = i18n.getFixedT('de')

    fireEvent.click(screen.getByText("Los geht's"))
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.business.title')), {
      target: { value: 'Acme' },
    })
    fireEvent.click(screen.getByText('Weiter')) // -> offer

    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.offer.scrapePrompt')), {
      target: { value: 'https://acme.com' },
    })
    fireEvent.click(screen.getByText(T('conciergeOnboarding.offer.scrapeButton')))

    // Gentle note, and the offer textarea is still editable (manual fallback).
    await waitFor(() =>
      expect(screen.getByText(T('conciergeOnboarding.offer.scrapeFailed'))).toBeInTheDocument(),
    )
    const offer = screen.getByLabelText(T('conciergeOnboarding.offer.title'))
    fireEvent.change(offer, { target: { value: 'Typed manually.' } })
    expect(offer).toHaveValue('Typed manually.')
  })

  it('surfaces a duplicate-slug error on the business step', async () => {
    createConcierge.mockRejectedValue(new Error('conciergeSetup.slugTaken'))
    renderPage()
    completeWizard('de')

    await waitFor(() =>
      expect(
        screen.getByText(i18n.getFixedT('de')('conciergeOnboarding.errors.slugTaken')),
      ).toBeInTheDocument(),
    )
  })

  // ---- Optional follow-up sender identity (done screen) ----

  it('does not put the follow-up sender fields in the way of finishing setup', async () => {
    // The 120-second promise: the wizard is still six steps, and the sender
    // panel is collapsed on the finish screen rather than being a seventh.
    createConcierge.mockResolvedValue({ id: 'con-f', slug: 'acme-coaching' })
    linkProvisionToConcierge.mockResolvedValue(undefined)
    renderPage()
    const T = i18n.getFixedT('de')
    completeWizard('de')

    await waitFor(() => expect(screen.getByText(T('conciergeOnboarding.done.title'))).toBeInTheDocument())
    // Offered, not demanded: no field is on screen until the coach asks for it.
    expect(screen.getByText(T('conciergeOnboarding.followup.open'))).toBeInTheDocument()
    expect(screen.queryByLabelText(T('conciergeOnboarding.followup.senderLabel'))).not.toBeInTheDocument()
    expect(saveFollowupSender).not.toHaveBeenCalled()
  })

  it('saves the sender identity through the service (never the ack timestamp)', async () => {
    createConcierge.mockResolvedValue({ id: 'con-f2', slug: 'acme-coaching' })
    linkProvisionToConcierge.mockResolvedValue(undefined)
    saveFollowupSender.mockResolvedValue(undefined)
    renderPage()
    const T = i18n.getFixedT('de')
    completeWizard('de')
    await waitFor(() => expect(screen.getByText(T('conciergeOnboarding.done.title'))).toBeInTheDocument())

    fireEvent.click(screen.getByText(T('conciergeOnboarding.followup.open')))
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.followup.senderLabel')), {
      target: { value: 'Acme Coaching GmbH, Musterstr. 1, 45127 Essen' },
    })
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.followup.privacyLabel')), {
      target: { value: 'https://acme.de/datenschutz' },
    })
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.followup.replyToLabel')), {
      target: { value: 'hallo@acme.de' },
    })
    fireEvent.click(screen.getByLabelText(T('conciergeOnboarding.followup.ackLabel')))
    fireEvent.click(screen.getByText(T('conciergeOnboarding.followup.save')))

    await waitFor(() => expect(saveFollowupSender).toHaveBeenCalled())
    const [provision, conciergeId, input] = saveFollowupSender.mock.calls[0]
    expect(provision).toBe('prov-1')
    expect(conciergeId).toBe('con-f2')
    expect(input).toEqual({
      senderBlock: 'Acme Coaching GmbH, Musterstr. 1, 45127 Essen',
      privacyUrl: 'https://acme.de/datenschutz',
      replyTo: 'hallo@acme.de',
    })
    // The browser sends no timestamp and no wording version: the edge function
    // mints both, because the database refuses them to any client.
    expect(Object.keys(input as object)).toEqual(['senderBlock', 'privacyUrl', 'replyTo'])
  })

  it('refuses to save without the acknowledgement ticked', async () => {
    createConcierge.mockResolvedValue({ id: 'con-f3', slug: 'acme-coaching' })
    linkProvisionToConcierge.mockResolvedValue(undefined)
    renderPage()
    const T = i18n.getFixedT('de')
    completeWizard('de')
    await waitFor(() => expect(screen.getByText(T('conciergeOnboarding.done.title'))).toBeInTheDocument())

    fireEvent.click(screen.getByText(T('conciergeOnboarding.followup.open')))
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.followup.senderLabel')), {
      target: { value: 'Acme Coaching GmbH, Musterstr. 1' },
    })
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.followup.privacyLabel')), {
      target: { value: 'https://acme.de/datenschutz' },
    })
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.followup.replyToLabel')), {
      target: { value: 'hallo@acme.de' },
    })
    fireEvent.click(screen.getByText(T('conciergeOnboarding.followup.save')))

    expect(screen.getByText(T('conciergeOnboarding.followup.errors.ackRequired'))).toBeInTheDocument()
    expect(saveFollowupSender).not.toHaveBeenCalled()
  })

  it('still shows success when linking the provision fails', async () => {
    createConcierge.mockResolvedValue({ id: 'con-1', slug: 'acme-coaching' })
    linkProvisionToConcierge.mockRejectedValue(new Error('conciergeSetup.saveFailed'))
    renderPage()
    completeWizard('de')

    await waitFor(() =>
      expect(
        screen.getByText(i18n.getFixedT('de')('conciergeOnboarding.done.title')),
      ).toBeInTheDocument(),
    )
  })
})
