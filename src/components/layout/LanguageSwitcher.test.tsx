import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import i18n from '../../i18n'
import { LanguageSwitcher } from './LanguageSwitcher'

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="pathname">{location.pathname}</span>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="*" element={<LanguageSwitcher />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    localStorage.clear()
    i18n.changeLanguage('de')
  })

  afterEach(() => {
    i18n.changeLanguage('de')
  })

  it('toggles the active language between DE and EN', () => {
    renderAt('/supported-software')

    const de = screen.getByRole('button', { name: 'DE' })
    const en = screen.getByRole('button', { name: 'EN' })

    expect(de).toHaveAttribute('aria-pressed', 'true')
    expect(en).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(en)

    expect(i18n.language).toBe('en')
    expect(en).toHaveAttribute('aria-pressed', 'true')
    expect(de).toHaveAttribute('aria-pressed', 'false')
  })

  it('persists the chosen language to localStorage', () => {
    renderAt('/supported-software')
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(localStorage.getItem('i18nextLng')).toBe('en')
  })

  it('navigates to /en when switching to English on the homepage', () => {
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByTestId('pathname')).toHaveTextContent('/en')
  })

  it('navigates back to / when switching to German on /en', () => {
    renderAt('/en')
    fireEvent.click(screen.getByRole('button', { name: 'DE' }))
    expect(screen.getByTestId('pathname')).toHaveTextContent('/')
  })

  it('does not navigate when switching language on a non-homepage route', () => {
    renderAt('/supported-software')
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByTestId('pathname')).toHaveTextContent('/supported-software')
  })
})
