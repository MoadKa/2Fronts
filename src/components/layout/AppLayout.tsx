import { useState } from 'react'
import { Outlet, Link } from 'react-router-dom'
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

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <Link to="/" className="app-logo">2Fronts</Link>
        <div className="app-nav-links">
          <Link to="/supported-software">{t('nav.supportedSoftware')}</Link>
          {user ? (
            <>
              {profile?.role === 'admin' && (
                <>
                  <Link to="/admin/automations">{t('nav.adminCatalog')}</Link>
                  <Link to="/admin/requests">{t('nav.adminRequests')}</Link>
                </>
              )}
              <Link to="/my-requests">{t('nav.myRequests')}</Link>
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
