import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HeroNightChat } from './HeroNightChat'
import i18n from '../../i18n'

/**
 * The chat plays on timers in production; forcing prefers-reduced-motion
 * makes it render the finished conversation synchronously, which is exactly
 * the accessibility fallback DESIGN.md mandates — so the tests exercise a
 * real code path, not a test-only shortcut.
 */
function forceReducedMotion() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

describe('HeroNightChat', () => {
  beforeEach(() => {
    forceReducedMotion()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await i18n.changeLanguage('de')
  })

  it('renders the complete lost-inquiry story in German, ending on the loss card', () => {
    render(<HeroNightChat />)
    // The night inquiry
    expect(screen.getByText(/Hallo! Ich interessiere mich für Ihr Coaching/)).toBeInTheDocument()
    // The too-late morning reply and the follow-up
    expect(screen.getByText(/Guten Morgen! Gerne, da war ich gestern schon offline/)).toBeInTheDocument()
    expect(screen.getByText(/Haben Sie noch Interesse an einem Erstgespräch\?/)).toBeInTheDocument()
    // The gut punch
    expect(screen.getByText(/bei einem anderen Coach gebucht/)).toBeInTheDocument()
    // The loss card with the concrete numbers
    expect(screen.getByText('Anfrage verloren')).toBeInTheDocument()
    expect(screen.getByText(/9 Std 22 Min · von der Konkurrenz gestohlen/)).toBeInTheDocument()
    // Day separators carry the time-passing structure
    expect(screen.getByText('Dienstag')).toBeInTheDocument()
    expect(screen.getByText('Donnerstag')).toBeInTheDocument()
  })

  it('renders the English script when the app language is English', async () => {
    await i18n.changeLanguage('en')
    render(<HeroNightChat />)
    expect(screen.getByText(/I am interested in your coaching/)).toBeInTheDocument()
    expect(screen.getByText('Lead lost')).toBeInTheDocument()
    expect(screen.getByText(/stolen by a competitor/)).toBeInTheDocument()
    expect(screen.getByText('Tuesday')).toBeInTheDocument()
  })

  it('replays the conversation when the replay chip is clicked', () => {
    render(<HeroNightChat />)
    fireEvent.click(screen.getByRole('button', { name: /noch mal abspielen/ }))
    // Under reduced motion the replay re-renders the finished story instantly.
    expect(screen.getByText('Anfrage verloren')).toBeInTheDocument()
  })
})
