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
    expect(screen.getByText('Payment received')).toBeInTheDocument()
  })

  it('shows a cancellation message for status=cancelled', () => {
    render(
      <MemoryRouter initialEntries={['/checkout/result?status=cancelled']}>
        <CheckoutResultPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Checkout cancelled')).toBeInTheDocument()
  })
})
