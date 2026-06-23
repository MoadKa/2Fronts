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
    expect(screen.getByText(/support@2fronts\.de/)).toBeInTheDocument()
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

  it('AGB renders in German', () => {
    i18n.changeLanguage('de')
    render(<AGBPage />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Allgemeine Geschäftsbedingungen (AGB)' })
    ).toBeInTheDocument()
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
})
