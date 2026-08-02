import { useEffect, useState } from 'react'
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
  const { t, i18n } = useTranslation()
  const [authModalOpen, setAuthModalOpen] = useState(false)

  // index.html ships a hard-coded lang="de", and i18n only swaps the copy — so
  // /en served English prose inside a German document. Screen readers then read
  // English with German phonetics, and the page contradicts its own hreflang.
  // This sits in the layout on purpose: /c/:slug renders outside it and sets its
  // own lang from the coach's setter, which must keep winning there.
  useEffect(() => {
    document.documentElement.lang = i18n.language
  }, [i18n.language])
  // The home page opens on the night half of the Doppelgänger seam; the white
  // glass nav would float on it like a lightbox. Both home routes get the dark
  // nav (/en renders the same page and needs the same treatment).
  const pathname = useLocation().pathname
  const isHome = pathname === '/' || pathname === '/en'

  // Single source of truth for an active-aware nav link, so the underline + amber
  // active state stays consistent across every entry.
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `app-nav-link${isActive ? ' is-active' : ''}`

  return (
    <div className="app-shell">
      {/* Off-screen until focused. Without it a keyboard visitor tabs the whole
          nav on every route before reaching the page itself. */}
      <a href="#inhalt" className="app-skip-link">{t('nav.skipToContent')}</a>
      <nav className={isHome ? 'app-nav app-nav-dg' : 'app-nav'}>
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
      <main className="app-main" id="inhalt">
        <Outlet />
      </main>
      <Footer variant={isHome ? 'dg' : undefined} />
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  )
}
