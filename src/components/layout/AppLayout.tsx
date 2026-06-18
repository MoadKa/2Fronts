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
        <Link to="/"><strong>2Fronts</strong></Link>
        <div className="app-nav-links">
          {user ? (
            <>
              <Link to="/my-requests">My Requests</Link>
              <span>{profile?.company_name}</span>
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
