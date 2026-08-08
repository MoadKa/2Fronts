import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  // The page probes the concierge's language on mount to render its opening
  // screen in the coach's language rather than the visitor's browser.
  fetchConciergeIntro: vi.fn().mockResolvedValue({ language: 'de', business_name: 'Test' }),
  newSessionId: () => 'test-session',
  CONCIERGE_UNAVAILABLE: 'conciergeChat.unavailable',
  CONCIERGE_ERROR: 'conciergeChat.error',
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

    // No marketplace nav sign-in button, and none of the marketplace footer.
    expect(screen.queryByText(T('nav.signInRegister'))).not.toBeInTheDocument()
    expect(screen.queryByText(T('footer.rights', { year: new Date().getFullYear() }))).not.toBeInTheDocument()
    expect(screen.queryByText('AGB')).not.toBeInTheDocument()
    expect(screen.queryByText(T('footer.forCoaches'))).not.toBeInTheDocument()
  })

  // Impressum and Datenschutz are the ONE exception to "no chrome", and they are
  // not chrome: 2Fronts operates this page under its own domain, so §5 DDG makes
  // the imprint mandatory here, and the follow-up consent notice sends visitors
  // to the privacy policy by name. A consent linking a page that does not exist
  // is not informed consent (Art. 13 DSGVO). The assertion above is deliberately
  // narrowed to the marketplace footer's own copy so the two cannot be confused.
  it('renders /c/:slug WITH its own minimal legal links', async () => {
    const T = i18n.getFixedT('de')
    const { container } = renderAppAt('/c/some-coach')
    await waitFor(() =>
      expect(screen.getByLabelText(T('conciergePublic.namePlaceholder'))).toBeInTheDocument(),
    )
    // Scoped to the page's own legal footer. The consent notice ALSO links the
    // privacy policy by name, deliberately — a notice that names a document it
    // does not link is not informed consent — so an unscoped query matches two
    // anchors and this assertion has to say which one it means.
    const legal = container.querySelector('.concierge-legal')
    expect(legal).not.toBeNull()
    expect(within(legal as HTMLElement).getByRole('link', { name: T('legal.impressum.title') }))
      .toHaveAttribute('href', '/impressum')
    expect(within(legal as HTMLElement).getByRole('link', { name: T('legal.datenschutz.title') }))
      .toHaveAttribute('href', '/datenschutz')
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
  // Its hero is the Doppelgänger seam: one headline, set once for assistive
  // tech and twice more visually, each copy clipped to its side of the seam.
  it('serves the catalog as the home page at /', async () => {
    const T = i18n.getFixedT('de')
    renderAppAt('/')
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: T('home.head') })).toBeInTheDocument(),
    )
  })

  // Without it a keyboard visitor tabs the entire nav on every route before
  // reaching the page. It must be the first tab stop and must point at a target
  // that exists, or it silently does nothing.
  it('offers a skip link as the first tab stop, pointing at the main landmark', async () => {
    const T = i18n.getFixedT('de')
    const { container } = renderAppAt('/')
    // The layout renders it, so it is there before the page's data resolves.
    // Waiting on the catalog's H1 instead made this the slowest test in the
    // suite and pushed it past the timeout under load.
    const skip = await screen.findByRole(
      'link',
      { name: T('nav.skipToContent') },
      // findBy defaults to 1s. Mounting the whole app tree with lazy routes
      // exceeds that when the suite runs all 39 files at once, which failed
      // this test once on load alone.
      { timeout: 4000 },
    )
    const tabbable = container.querySelectorAll('a[href], button, input, select, textarea')
    expect(tabbable[0]).toBe(skip)
    const target = skip.getAttribute('href')!.slice(1)
    expect(container.querySelector(`#${target}`)).toBe(container.querySelector('main'))
  }, 15000)
})
