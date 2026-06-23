import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '../../../i18n'
import { ImpressumPage } from './ImpressumPage'

describe('ImpressumPage (i18n)', () => {
  afterEach(() => {
    i18n.changeLanguage('de')
  })

  it('renders the German heading by default', () => {
    i18n.changeLanguage('de')
    render(<ImpressumPage />)
    expect(screen.getByRole('heading', { name: 'Impressum' })).toBeInTheDocument()
    expect(screen.getByText('Dieser Inhalt wird in Kürze verfügbar sein.')).toBeInTheDocument()
  })

  it('renders the English heading after switching to English', () => {
    i18n.changeLanguage('en')
    render(<ImpressumPage />)
    expect(screen.getByRole('heading', { name: 'Imprint' })).toBeInTheDocument()
    expect(screen.getByText('This content will be available soon.')).toBeInTheDocument()
  })
})
