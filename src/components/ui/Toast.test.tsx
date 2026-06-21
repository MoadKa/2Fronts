import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider, useToast } from './Toast'

function Trigger() {
  const { showToast } = useToast()
  return <button onClick={() => showToast('Saved!', 'success')}>Trigger</button>
}

describe('Toast', () => {
  it('shows a toast message when showToast is called', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))
    expect(screen.getByText('Saved!')).toBeInTheDocument()
  })

  it('announces toast messages to screen readers via aria-live', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))
    expect(screen.getByText('Saved!').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
  })
})
