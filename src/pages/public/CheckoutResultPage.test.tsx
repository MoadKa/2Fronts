import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CheckoutResultPage } from './CheckoutResultPage'

describe('CheckoutResultPage', () => {
  it('shows a success message for status=success', () => {
    render(
      <MemoryRouter initialEntries={['/checkout/result?status=success']}>
        <CheckoutResultPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Zahlung erhalten')).toBeInTheDocument()
    // No trial param -> no trial copy (default behavior unchanged).
    expect(screen.queryByText('Testphase gestartet')).not.toBeInTheDocument()
  })

  it('shows trial-specific copy for status=success&trial=1 (nothing was charged yet)', () => {
    render(
      <MemoryRouter initialEntries={['/checkout/result?status=success&trial=1']}>
        <CheckoutResultPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Testphase gestartet')).toBeInTheDocument()
    expect(screen.getByText('14 Tage kostenlos. Die erste Abbuchung kommt erst nach der Testphase. Jetzt bekommt dein Setter seine Inhalte.')).toBeInTheDocument()
    expect(screen.queryByText('Zahlung erhalten')).not.toBeInTheDocument()
  })

  it('shows a cancellation message for status=cancelled', () => {
    render(
      <MemoryRouter initialEntries={['/checkout/result?status=cancelled']}>
        <CheckoutResultPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Checkout abgebrochen')).toBeInTheDocument()
  })
})
