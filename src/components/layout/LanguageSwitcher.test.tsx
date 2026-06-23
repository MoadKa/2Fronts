import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from '../../i18n'
import { LanguageSwitcher } from './LanguageSwitcher'

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    localStorage.clear()
    i18n.changeLanguage('de')
  })

  afterEach(() => {
    i18n.changeLanguage('de')
  })

  it('toggles the active language between DE and EN', () => {
    render(<LanguageSwitcher />)

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
    render(<LanguageSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(localStorage.getItem('i18nextLng')).toBe('en')
  })
})
