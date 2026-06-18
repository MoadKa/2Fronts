import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { useAuth } from '../../contexts/AuthContext'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))

function renderProtected() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/" element={<p>Home</p>} />
        <Route element={<ProtectedRoute requireRole="admin" />}>
          <Route path="/admin" element={<p>Admin area</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute', () => {
  it('redirects to home when there is no user', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, profile: null, loading: false, signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })
    renderProtected()
    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('redirects to home when the role does not match', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1' } as never,
      profile: { id: 'u1', role: 'customer', company_name: 'Acme', email: 'a@acme.com' },
      loading: false,
      signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
    })
    renderProtected()
    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('renders the nested route when the role matches', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1' } as never,
      profile: { id: 'u1', role: 'admin', company_name: 'Acme', email: 'a@acme.com' },
      loading: false,
      signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
    })
    renderProtected()
    expect(screen.getByText('Admin area')).toBeInTheDocument()
  })
})
