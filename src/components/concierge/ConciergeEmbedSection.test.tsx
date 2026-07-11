import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConciergeEmbedSection } from './ConciergeEmbedSection'

// The exact one-liner the component must show and copy (mirrors the private
// embedSnippet() helper — the component file only exports the component).
const expectedSnippet = (slug: string) =>
  `<script src="${window.location.origin}/embed.js" data-concierge="${slug}" async></script>`

describe('ConciergeEmbedSection', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    writeText.mockReset()
    // jsdom has no navigator.clipboard; provide the one API the component uses.
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('renders the one-line snippet with the real slug and the embed.js src', () => {
    render(<ConciergeEmbedSection slugs={['acme-coaching']} />)
    const code = screen.getByLabelText('Code zum Einbauen')
    expect(code.textContent).toContain('data-concierge="acme-coaching"')
    expect(code.textContent).toContain(`${window.location.origin}/embed.js`)
    expect(code.textContent).toContain('async')
    // It is the EXACT snippet the copy button writes.
    expect(code.textContent).toBe(expectedSnippet('acme-coaching'))
  })

  it('copies the snippet to the clipboard and confirms with "Kopiert!"', () => {
    render(<ConciergeEmbedSection slugs={['acme']} />)
    fireEvent.click(screen.getByRole('button', { name: 'Kopieren' }))
    expect(writeText).toHaveBeenCalledWith(expectedSnippet('acme'))
    expect(screen.getByRole('button', { name: 'Kopiert!' })).toBeInTheDocument()
  })

  it('shows the 3-step tutorial and the collapsible platform hints', () => {
    render(<ConciergeEmbedSection slugs={['acme']} />)
    expect(screen.getByText('Auf deiner Website einbauen')).toBeInTheDocument()
    expect(screen.getByText('Kopiere die Zeile oben.')).toBeInTheDocument()
    expect(
      screen.getByText('Speichern und die Seite neu laden. Die Chat-Blase erscheint unten rechts.'),
    ).toBeInTheDocument()
    for (const platform of ['WordPress', 'Wix', 'Squarespace', 'Webflow', 'Jimdo']) {
      expect(screen.getByText(platform)).toBeInTheDocument()
    }
  })

  it('renders one snippet per concierge when the coach has several', () => {
    render(<ConciergeEmbedSection slugs={['acme', 'beta-coaching']} />)
    const codes = screen.getAllByLabelText('Code zum Einbauen')
    expect(codes).toHaveLength(2)
    expect(codes[0].textContent).toContain('data-concierge="acme"')
    expect(codes[1].textContent).toContain('data-concierge="beta-coaching"')
  })
})
