import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'

const mockProfile = { id: 'user-1', role: 'customer', company_name: 'Acme', email: 'a@acme.com' }
const authState: { session: { user: { id: string; email: string } } | null } = { session: null }

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: authState.session } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signUp: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null })),
      signInWithPassword: vi.fn(() => Promise.resolve({ error: null })),
      signOut: vi.fn(() => Promise.resolve()),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: mockProfile }) }) }),
      insert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}))

function Probe() {
  const { user, loading, signUp } = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.id ?? 'none'}</span>
      <button onClick={() => signUp('a@acme.com', 'pw123456', 'Acme')}>Sign up</button>
    </div>
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    authState.session = null
  })

  it('finishes loading with no user when there is no session', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    expect(screen.getByTestId('user').textContent).toBe('none')
  })

  it('signUp creates the auth user and a matching profile row', async () => {
    const { supabase } = await import('../lib/supabaseClient')
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    await waitFor(() =>
      expect(supabase.auth.signUp).toHaveBeenCalledWith({ email: 'a@acme.com', password: 'pw123456' })
    )
    expect(supabase.from).toHaveBeenCalledWith('profiles')
  })
})
