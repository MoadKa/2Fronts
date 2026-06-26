import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuthModal } from './AuthModal'
import { useAuth } from '../../contexts/AuthContext'
import { ToastProvider } from '../ui/Toast'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

describe('AuthModal', () => {
  it('calls signIn with the entered credentials', async () => {
    const signIn = vi.fn(() => Promise.resolve())
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp: vi.fn(), signIn, signOut: vi.fn() })
    render(<ToastProvider><AuthModal isOpen onClose={() => {}} /></ToastProvider>)
    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('a@b.com', 'secret123'))
  })

  it('shows a "check your email" confirmation message and stays open when signUp needs confirmation', async () => {
    const signUp = vi.fn(() => Promise.resolve({ needsConfirmation: true }))
    const onClose = vi.fn()
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp, signIn: vi.fn(), signOut: vi.fn() })
    render(<ToastProvider><AuthModal isOpen onClose={onClose} /></ToastProvider>)
    // Switch to the sign-up tab (toggle button), then fill + submit.
    fireEvent.click(screen.getByRole('button', { name: 'Noch kein Konto? Registrieren' }))
    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrieren' }))
    await waitFor(() => expect(signUp).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText(/Fast geschafft/i)).toBeInTheDocument())
    // Must NOT fire the signed-in success path that assumes a session.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('Konto erstellt')).not.toBeInTheDocument()
  })

  it('closes with the normal success path when signUp does not need confirmation', async () => {
    const signUp = vi.fn(() => Promise.resolve({ needsConfirmation: false }))
    const onClose = vi.fn()
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp, signIn: vi.fn(), signOut: vi.fn() })
    render(<ToastProvider><AuthModal isOpen onClose={onClose} /></ToastProvider>)
    // Switch to the sign-up tab (toggle button), then fill + submit.
    fireEvent.click(screen.getByRole('button', { name: 'Noch kein Konto? Registrieren' }))
    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrieren' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByText(/bestätige/i)).not.toBeInTheDocument()
  })

  it('shows an error message when sign in fails', async () => {
    const signIn = vi.fn(() => Promise.reject(new Error('Invalid credentials')))
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp: vi.fn(), signIn, signOut: vi.fn() })
    render(<ToastProvider><AuthModal isOpen onClose={() => {}} /></ToastProvider>)
    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
    await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeInTheDocument())
  })
})
