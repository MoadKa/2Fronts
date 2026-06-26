import { useState } from 'react'
import { Outlet, Link, NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { AuthModal } from '../auth/AuthModal'
import { Button } from '../ui/Button'
import { Footer } from './Footer'
import { LanguageSwitcher } from './LanguageSwitcher'
import './AppLayout.css'

export function AppLayout() {
  const { user, profile, signOut } = useAuth()
  const { t } = useTranslation()
  const [authModalOpen, setAuthModalOpen] = useState(false)

  // Single source of truth for an active-aware nav link, so the underline + amber
  // active state stays consistent across every entry.
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `app-nav-link${isActive ? ' is-active' : ''}`

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <Link to="/" className="app-logo">
          <span className="app-logo-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 18V7l8 5 8-5v11" />
            </svg>
          </span>
          <span className="app-logo-word">2Fronts</span>
        </Link>
        <div className="app-nav-links">
          <NavLink to="/supported-software" className={navClass}>{t('nav.supportedSoftware')}</NavLink>
          {user ? (
            <>
              {profile?.role === 'admin' && (
                <>
                  <NavLink to="/admin/automations" className={navClass}>{t('nav.adminCatalog')}</NavLink>
                  <NavLink to="/admin/requests" className={navClass}>{t('nav.adminRequests')}</NavLink>
                </>
              )}
              <NavLink to="/my-requests" className={navClass}>{t('nav.myRequests')}</NavLink>
              <NavLink to="/app/chats" className={navClass}>{t('nav.chats')}</NavLink>
              <span className="app-nav-company">{profile?.company_name}</span>
              <Button variant="secondary" onClick={() => signOut()}>{t('nav.signOut')}</Button>
            </>
          ) : (
            <Button onClick={() => setAuthModalOpen(true)}>{t('nav.signInRegister')}</Button>
          )}
          <LanguageSwitcher />
        </div>
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
      <Footer />
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  )
}
