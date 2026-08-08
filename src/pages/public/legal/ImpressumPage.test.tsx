import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '../../../i18n'
import { ImpressumPage } from './ImpressumPage'
import { DatenschutzPage } from './DatenschutzPage'
import { AGBPage } from './AGBPage'

// The legal pages must render publicly (no auth, no router context, no
// providers) in both supported locales. These components only depend on
// react-i18next, so rendering them bare proves they have no auth dependency.
afterEach(() => {
  i18n.changeLanguage('de')
})

describe('Legal pages render publicly (DE)', () => {
  it('Impressum renders the German heading without the DRAFT banner', () => {
    i18n.changeLanguage('de')
    render(<ImpressumPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Impressum' })).toBeInTheDocument()
    expect(screen.queryByText(/ENTWURF/)).toBeNull()
    // Real provider data from the eRecht24 Impressum is filled in (appears in
    // both the Diensteanbieter and Verantwortlich sections).
    expect(screen.getAllByText(/Moad Kaoukab/).length).toBeGreaterThan(0)
    expect(screen.getByText(/moad@2fronts\.de/)).toBeInTheDocument()
  })

  // Regression: the phone number sat in both locale files for months and was
  // never rendered — the page printed the email alone. §5 Abs. 1 Nr. 2 TMG wants
  // a channel allowing "unmittelbare Kommunikation", and EuGH C-298/07 lets
  // email stand by itself only where a comparably fast second route exists.
  it('Impressum renders the phone number, not just the email', () => {
    i18n.changeLanguage('de')
    render(<ImpressumPage />)
    expect(screen.getByText(/\+49 15566237817/)).toBeInTheDocument()
  })

  // The EU ODR platform stopped operating on 2025-07-20. Pointing visitors at a
  // dead redress route is worse than saying nothing, so the link is gone and the
  // §36 VSBG declaration stays.
  it('Impressum no longer links the discontinued EU ODR platform', () => {
    i18n.changeLanguage('de')
    render(<ImpressumPage />)
    expect(screen.queryByText(/ec\.europa\.eu\/consumers\/odr/)).toBeNull()
    expect(screen.getByText(/nicht bereit und nicht verpflichtet/)).toBeInTheDocument()
  })

  it('Datenschutz renders in German and contains the Google Limited Use clause verbatim', () => {
    i18n.changeLanguage('de')
    render(<DatenschutzPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Datenschutzerklärung' })).toBeInTheDocument()
    expect(
      screen.getByText(
        "2Fronts' use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements."
      )
    ).toBeInTheDocument()
  })

  // The consent notice a visitor reads on /c/:slug names a retention period and
  // sends them here for the detail. If this section is missing, or names a
  // different number of years, or claims a legal obligation nobody imposed
  // (lit. c rather than lit. f), the consent it backs is not informed.
  it('Datenschutz discloses the follow-up consent evidence (IP, lit. f, three years, Resend)', () => {
    i18n.changeLanguage('de')
    render(<DatenschutzPage />)
    // Anchor on the purpose sentence: it is unique to this section's body.
    const section = screen.getByText(/Nachweisbarkeit der Einwilligung/)
    expect(section).toHaveTextContent('IP-Adresse')
    expect(section).toHaveTextContent('User-Agent')
    // Berechtigtes Interesse an der Nachweisbarkeit — NOT lit. c, since no
    // statute obliges storing the IP.
    expect(section).toHaveTextContent('Art. 6 Abs. 1 lit. f')
    expect(section).not.toHaveTextContent('lit. c')
    // Word for word the figure the on-screen notice states.
    expect(section).toHaveTextContent('drei Jahre')
    expect(section).toHaveTextContent('Resend')
  })

  it('AGB renders in German', () => {
    i18n.changeLanguage('de')
    render(<AGBPage />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Allgemeine Geschäftsbedingungen (AGB)' })
    ).toBeInTheDocument()
  })

  // Trial reinstatement 2026-07-10: the AGB must disclose the 14-day trial,
  // the first-charge timing, the no-second-trial rule, and free cancellation
  // during the trial. Legally load-bearing copy — assert it renders.
  it('AGB (DE) discloses the 14-day trial terms', () => {
    i18n.changeLanguage('de')
    render(<AGBPage />)
    expect(screen.getByText(/kostenlosen Testphase von 14 Tagen/)).toBeInTheDocument()
    expect(screen.getByText(/wird keine erneute Testphase gewährt/)).toBeInTheDocument()
    expect(screen.getByText(/Wird während der Testphase gekündigt, entstehen keine Kosten/)).toBeInTheDocument()
  })
})

describe('Legal pages render publicly (EN)', () => {
  it('Impressum renders the English heading', () => {
    i18n.changeLanguage('en')
    render(<ImpressumPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Imprint' })).toBeInTheDocument()
    expect(screen.queryByText(/DRAFT/)).toBeNull()
  })

  it('Datenschutz renders in English and keeps the Google Limited Use clause verbatim', () => {
    i18n.changeLanguage('en')
    render(<DatenschutzPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
    expect(
      screen.getByText(
        "2Fronts' use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements."
      )
    ).toBeInTheDocument()
  })

  it('AGB renders in English', () => {
    i18n.changeLanguage('en')
    render(<AGBPage />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'General Terms and Conditions (GTC)' })
    ).toBeInTheDocument()
  })

  it('AGB (EN) discloses the 14-day trial terms', () => {
    i18n.changeLanguage('en')
    render(<AGBPage />)
    expect(screen.getByText(/free 14-day trial period/)).toBeInTheDocument()
    expect(screen.getByText(/no further trial period is granted/)).toBeInTheDocument()
    expect(screen.getByText(/cancelled during the trial period, no charges are incurred/)).toBeInTheDocument()
  })
})
