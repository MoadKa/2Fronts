import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import i18n from './i18n'
import App from './App'

// AuthProvider calls the Supabase client on mount (getSession + onAuthStateChange).
// Stub it so the app tree renders without env/network.
vi.mock('./lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}))

// The public concierge page talks to ConciergeService; stub it so mounting the
// route needs no network.
vi.mock('./services/ConciergeService', () => ({
  sendConciergeMessage: vi.fn(),
  newSessionId: () => 'test-session',
}))

function renderAppAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('App routing — public concierge is standalone', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
  })

  // Regression: the public concierge a coach shares with prospects must NOT carry
  // the 2Fronts marketplace chrome (nav with "Anmelden / Registrieren", footer).
  // It used to be nested under AppLayout; it must render bare.
  it('renders /c/:slug without the 2Fronts marketplace nav or footer', async () => {
    const T = i18n.getFixedT('de')
    renderAppAt('/c/some-coach')

    // The concierge chat itself renders (it opens with the name/email contact form).
    await waitFor(() =>
      expect(screen.getByLabelText(T('conciergePublic.namePlaceholder'))).toBeInTheDocument(),
    )

    // No marketplace nav sign-in button, no footer legal links.
    expect(screen.queryByText(T('nav.signInRegister'))).not.toBeInTheDocument()
    expect(screen.queryByText('Impressum')).not.toBeInTheDocument()
    expect(screen.queryByText('AGB')).not.toBeInTheDocument()
  })

  // Control: a normal marketplace route DOES carry the nav, proving the chrome
  // exists and was removed only for the concierge.
  it('still renders the marketplace nav on a normal route', async () => {
    const T = i18n.getFixedT('de')
    renderAppAt('/datenschutz')
    await waitFor(() =>
      expect(screen.getByText(T('nav.signInRegister'))).toBeInTheDocument(),
    )
  })

  // The catalog is now the home page (replaced the waitlist landing at /).
  it('serves the catalog as the home page at /', async () => {
    const T = i18n.getFixedT('de')
    renderAppAt('/')
    await waitFor(() => expect(screen.getByText(T('catalog.heroTitle'))).toBeInTheDocument())
  })
})
