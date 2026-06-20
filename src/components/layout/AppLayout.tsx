import { useState } from 'react'
import { Outlet, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { AuthModal } from '../auth/AuthModal'
import { Button } from '../ui/Button'
import './AppLayout.css'

export function AppLayout() {
  const { user, profile, signOut } = useAuth()
  const [authModalOpen, setAuthModalOpen] = useState(false)

  return (
    <div>
      <nav className="app-nav">
        <Link to="/" className="app-logo">2Fronts</Link>
        <div className="app-nav-links">
          {user ? (
            <>
              {profile?.role === 'admin' && (
                <>
                  <Link to="/admin/automations">Admin Catalog</Link>
                  <Link to="/admin/requests">Admin Requests</Link>
                </>
              )}
              <Link to="/my-requests">My Requests</Link>
              <span className="app-nav-company">{profile?.company_name}</span>
              <Button variant="secondary" onClick={() => signOut()}>Log out</Button>
            </>
          ) : (
            <Button onClick={() => setAuthModalOpen(true)}>Log in / Sign up</Button>
          )}
        </div>
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  )
}
