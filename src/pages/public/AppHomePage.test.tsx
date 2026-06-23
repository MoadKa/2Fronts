import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppHomePage } from './AppHomePage'

function renderPage() {
  return render(
    <MemoryRouter>
      <AppHomePage />
    </MemoryRouter>
  )
}

describe('AppHomePage', () => {
  it('describes the product (Google reviewers need clear relevance)', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByText(/Was 2Fronts macht/i)).toBeInTheDocument()
    // mentions Google data usage
    expect(screen.getByText(/Google-Konto/i)).toBeInTheDocument()
  })

  it('links the privacy policy at /datenschutz', () => {
    renderPage()
    const link = screen.getByRole('link', { name: /Datenschutzerklärung/i })
    expect(link).toHaveAttribute('href', '/datenschutz')
  })

  it('has a sign-in CTA', () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'Anmelden' })).toBeInTheDocument()
  })
})
