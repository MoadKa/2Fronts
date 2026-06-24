import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import i18n from '../../i18n'
import { ConciergeSetupPage } from './ConciergeSetupPage'

const createConcierge = vi.fn()
const linkProvisionToConcierge = vi.fn()
const draftConciergeFromUrl = vi.fn()
vi.mock('../../services/ConciergeService', () => ({
  createConcierge: (...a: unknown[]) => createConcierge(...a),
  linkProvisionToConcierge: (...a: unknown[]) => linkProvisionToConcierge(...a),
  draftConciergeFromUrl: (...a: unknown[]) => draftConciergeFromUrl(...a),
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
  fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.booking.title')), {
    target: { value: 'https://cal.com/acme' },
  })
  next()
  // Step 5 tone -> finish
  fireEvent.click(screen.getByText(T('conciergeOnboarding.tone.finish')))
}

describe('ConciergeSetupPage onboarding wizard', () => {
  beforeEach(async () => {
    createConcierge.mockReset()
    linkProvisionToConcierge.mockReset()
    draftConciergeFromUrl.mockReset()
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
    // Step 1 of 5.
    expect(screen.getByText('Schritt 1 von 5')).toBeInTheDocument()
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
    fireEvent.change(screen.getByLabelText(T('conciergeOnboarding.booking.title')), {
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
