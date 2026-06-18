import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from './Toast'
import { useToast } from './useToast'

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
})
