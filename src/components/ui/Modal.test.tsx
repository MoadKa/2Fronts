import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Modal } from './Modal'

describe('Modal', () => {
  it('renders children when open and calls onClose on overlay click', () => {
    const onClose = vi.fn()
    render(
      <Modal isOpen onClose={onClose}>
        <p>Hello inside modal</p>
      </Modal>
    )
    expect(screen.getByText('Hello inside modal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('modal-overlay'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('announces itself as a named modal dialog', () => {
    render(
      <Modal isOpen onClose={() => {}} label="Sign in">
        <p>Body</p>
      </Modal>
    )
    const dialog = screen.getByRole('dialog', { name: 'Sign in' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('closes on Escape and hands focus back to whatever opened it', () => {
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const { rerender } = render(
      <Modal isOpen onClose={onClose} label="Sign in">
        <button>Inside</button>
      </Modal>
    )
    // Focus moves in, so a keyboard visitor is not left behind the scrim.
    expect(screen.getByText('Inside')).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()

    rerender(
      <Modal isOpen={false} onClose={onClose} label="Sign in">
        <button>Inside</button>
      </Modal>
    )
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('keeps Tab inside the dialog', () => {
    render(
      <Modal isOpen onClose={() => {}} label="Sign in">
        <button>First</button>
        <button>Last</button>
      </Modal>
    )
    const last = screen.getByText('Last')
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByText('First')).toHaveFocus()
  })

  it('renders nothing when closed', () => {
    render(
      <Modal isOpen={false} onClose={() => {}}>
        <p>Hidden</p>
      </Modal>
    )
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })
})
