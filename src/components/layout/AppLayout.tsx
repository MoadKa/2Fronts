import { useState } from 'react'
import { Outlet, Link, NavLink, useLocation } from 'react-router-dom'
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
  // The homepage opens on the Nachttisch night hero (DESIGN.md); the white
  // glass nav would float on it like a lightbox. Home gets the night nav.
  const isNight = useLocation().pathname === '/'

  // Single source of truth for an active-aware nav link, so the underline + amber
  // active state stays consistent across every entry.
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `app-nav-link${isActive ? ' is-active' : ''}`

  return (
    <div className="app-shell">
      <nav className={isNight ? 'app-nav app-nav-night' : 'app-nav'}>
        <Link to="/" className="app-logo">
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
