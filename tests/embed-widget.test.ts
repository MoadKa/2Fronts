import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// public/embed.js is the dependency-free widget a coach pastes into their own
// website. It is not part of the Vite build, so we exercise it here by
// evaluating the file inside jsdom with a fake host page.

const source = readFileSync(resolve(__dirname, '../public/embed.js'), 'utf8')

function loadWidget(attrs: Record<string, string> = {}, slug = 'acme') {
  // document.currentScript is null when eval'ing via new Function(), so the
  // widget uses its querySelector('script[data-concierge]') fallback — which
  // always resolves to the FIRST matching tag in the document (a separate,
  // already-flagged limitation of that fallback, not what this helper tests).
  // Removing any earlier tag(s) here isolates loadWidget() calls from that
  // limitation so callers can mount several DIFFERENT slugs in one test and
  // exercise the mount-time guard/registry logic in isolation.
  document.querySelectorAll('script[data-concierge]').forEach((el) => el.remove())
  const script = document.createElement('script')
  script.src = 'https://2fronts.de/embed.js'
  script.setAttribute('data-concierge', slug)
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v)
  document.body.appendChild(script)
  new Function(source)()
}

describe('public/embed.js widget', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    // The widget reads the host page's language for its labels; jsdom's
    // navigator.language is en-US, so pin a German host page like the suite
    // does for the app (see src/test-setup.ts).
    document.documentElement.lang = 'de'
    sessionStorage.clear()
    // The double-mount guard lives on `window`, which persists across tests
    // (unlike document.head/body, reset above) — clear it so one test's
    // mounted slug doesn't make the next test's same-slug mount a no-op.
    delete (window as unknown as { __tfEmbedMounted?: unknown }).__tfEmbedMounted
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the chat bubble with an aria-label and no iframe yet', () => {
    loadWidget()
    const bubble = document.getElementById('tf-embed-bubble-acme')
    expect(bubble).not.toBeNull()
    expect(bubble!.getAttribute('aria-label')).toBe('Chat öffnen')
    expect(bubble!.getAttribute('aria-expanded')).toBe('false')
    // The iframe is lazy: nothing loads until the visitor opens the chat.
    expect(document.getElementById('tf-embed-frame-acme')).toBeNull()
  })

  it('shows the robot icon at rest, not the old speech-bubble glyph', () => {
    loadWidget()
    const svg = document.querySelector('#tf-embed-bubble-acme svg')!
    // The robot antenna path is the distinguishing mark of the calm launcher.
    expect(svg.innerHTML).toContain('M12 3.5v2.2')
    // Regression: the previous speech-bubble path must be gone.
    expect(svg.innerHTML).not.toContain('M21 11.5a8.38')
  })

  it('opens on click with an iframe pointing at the script origin /c/<slug>?embed=1', () => {
    loadWidget()
    document.getElementById('tf-embed-bubble-acme')!.click()

    const panel = document.getElementById('tf-embed-panel-acme')!
    expect(panel.classList.contains('tf-embed-open')).toBe(true)
    const frame = document.getElementById('tf-embed-frame-acme') as HTMLIFrameElement
    expect(frame.src).toBe('https://2fronts.de/c/acme?embed=1')
    expect(document.getElementById('tf-embed-bubble-acme')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('closes on second bubble click, on the × button, and on Escape', () => {
    loadWidget()
    const bubble = document.getElementById('tf-embed-bubble-acme')!
    const panel = document.getElementById('tf-embed-panel-acme')!

    bubble.click()
    bubble.click() // second click closes
    expect(panel.classList.contains('tf-embed-open')).toBe(false)

    bubble.click()
    document.getElementById('tf-embed-close-acme')!.click()
    expect(panel.classList.contains('tf-embed-open')).toBe(false)

    bubble.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(panel.classList.contains('tf-embed-open')).toBe(false)
  })

  // jsdom does not deliver real cross-window postMessage traffic from an
  // <iframe>'s contentWindow back to the parent (no fully wired browsing
  // context without extra jsdom config), so these tests exercise the
  // listener's exact comparison logic directly via a synthetic MessageEvent
  // with an explicit origin/source, instead of a real iframe.postMessage()
  // round-trip. ConciergePublicPage's real browser behavior is what actually
  // sends this message; this covers embed.js's receiving side.
  function dispatchEscape(source: Window | null, origin = 'https://2fronts.de') {
    window.dispatchEvent(
      new MessageEvent('message', { data: { source: 'tf-embed', type: 'escape' }, origin, source }),
    )
  }

  it('closes when it receives a tf-embed escape message from its own iframe, at the app origin', async () => {
    // The chat itself runs in a cross-origin iframe, so Escape pressed inside
    // it never reaches this document's keydown listener — ConciergePublicPage
    // forwards it via postMessage instead. This is the embed.js side of that bridge.
    loadWidget()
    const bubble = document.getElementById('tf-embed-bubble-acme')!
    const panel = document.getElementById('tf-embed-panel-acme')!
    bubble.click()
    expect(panel.classList.contains('tf-embed-open')).toBe(true)

    const frame = document.getElementById('tf-embed-frame-acme') as HTMLIFrameElement
    dispatchEscape(frame.contentWindow)
    await vi.waitFor(() => expect(panel.classList.contains('tf-embed-open')).toBe(false))
  })

  it('ignores postMessage events that are not the tf-embed escape shape', async () => {
    loadWidget()
    const bubble = document.getElementById('tf-embed-bubble-acme')!
    const panel = document.getElementById('tf-embed-panel-acme')!
    bubble.click()

    // Malformed / foreign messages (other widgets, browser extensions, etc.)
    // must never close the panel, even from the widget's own iframe.
    const frame = document.getElementById('tf-embed-frame-acme') as HTMLIFrameElement
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'tf-embed', type: 'not-escape' },
        origin: 'https://2fronts.de',
        source: frame.contentWindow,
      }),
    )
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'escape' },
        origin: 'https://2fronts.de',
        source: frame.contentWindow,
      }),
    )
    window.dispatchEvent(
      new MessageEvent('message', { data: 'a plain string message', origin: 'https://2fronts.de', source: frame.contentWindow }),
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(panel.classList.contains('tf-embed-open')).toBe(true)
  })

  it('ignores a correctly-shaped escape message posted from the wrong origin', async () => {
    // Guards against another script on the host page forging the message —
    // it must come from OUR app's origin, not just any window.
    loadWidget()
    const bubble = document.getElementById('tf-embed-bubble-acme')!
    const panel = document.getElementById('tf-embed-panel-acme')!
    bubble.click()

    const frame = document.getElementById('tf-embed-frame-acme') as HTMLIFrameElement
    dispatchEscape(frame.contentWindow, 'https://evil.example')
    await new Promise((r) => setTimeout(r, 0))
    expect(panel.classList.contains('tf-embed-open')).toBe(true)
  })

  it('ignores a correctly-shaped, correct-origin escape message from a different concierge\'s iframe', async () => {
    // Two widgets on the same page (two concierges, one site-wide snippet
    // field) must not close each other — only escape from acme's OWN iframe
    // may close acme's panel, even though both share the same app origin.
    loadWidget({}, 'acme')
    loadWidget({}, 'beta')
    const acmeBubble = document.getElementById('tf-embed-bubble-acme')!
    const acmePanel = document.getElementById('tf-embed-panel-acme')!
    const betaBubble = document.getElementById('tf-embed-bubble-beta')!
    acmeBubble.click()
    betaBubble.click()
    expect(acmePanel.classList.contains('tf-embed-open')).toBe(true)

    // beta's iframe posts escape — same origin, but the WRONG source window.
    const betaFrame = document.getElementById('tf-embed-frame-beta') as HTMLIFrameElement
    dispatchEscape(betaFrame.contentWindow)
    await new Promise((r) => setTimeout(r, 0))
    expect(acmePanel.classList.contains('tf-embed-open')).toBe(true)
  })

  it('defaults to the bottom-right corner with no offset', () => {
    loadWidget()
    const style = document.getElementById('tf-embed-style-acme')!.textContent!
    expect(style).toContain('#tf-embed-bubble-acme{position:fixed;right:20px;bottom:20px')
    expect(style).toContain('#tf-embed-panel-acme{position:fixed;right:20px;bottom:96px')
  })

  it('data-position="left" mirrors bubble, panel, and invite to the bottom-left', () => {
    loadWidget({ 'data-position': 'left' })
    const style = document.getElementById('tf-embed-style-acme')!.textContent!
    expect(style).toContain('#tf-embed-bubble-acme{position:fixed;left:20px;bottom:20px')
    expect(style).toContain('#tf-embed-panel-acme{position:fixed;left:20px;bottom:96px')
    expect(style).toContain('#tf-embed-invite-acme{position:fixed;left:92px')
    // The speech tail flips to the invite's left edge, pointing at the bubble.
    expect(style).toContain('#tf-embed-invite-acme::after{content:"";position:absolute;left:-6px')
  })

  it('data-offset-bottom lifts bubble, invite, and panel by N pixels', () => {
    loadWidget({ 'data-offset-bottom': '90' })
    const style = document.getElementById('tf-embed-style-acme')!.textContent!
    expect(style).toContain('#tf-embed-bubble-acme{position:fixed;right:20px;bottom:110px')
    expect(style).toContain('#tf-embed-invite-acme{position:fixed;right:92px;bottom:120px')
    expect(style).toContain('#tf-embed-panel-acme{position:fixed;right:20px;bottom:186px')
  })

  it('ignores garbage data-position and data-offset-bottom values', () => {
    loadWidget({ 'data-position': 'top', 'data-offset-bottom': 'lots' })
    const style = document.getElementById('tf-embed-style-acme')!.textContent!
    expect(style).toContain('#tf-embed-bubble-acme{position:fixed;right:20px;bottom:20px')
  })

  it('applies data-color as the accent (icon/border/ring), keeping the disc calm', () => {
    loadWidget({ 'data-color': '#123456' })
    const style = document.getElementById('tf-embed-style-acme')!
    // Accent now paints the robot + focus ring via `color`, not the whole fill…
    expect(style.textContent).toContain('color:#123456')
    // …and the launcher disc stays a quiet light surface.
    expect(style.textContent).toContain('background:#FFFDF7')
  })

  it('does nothing without a data-concierge slug', () => {
    const script = document.createElement('script')
    script.src = 'https://2fronts.de/embed.js'
    document.body.appendChild(script)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new Function(source)()
    expect(document.getElementById('tf-embed-bubble-acme')).toBeNull()
    warn.mockRestore()
  })

  it('does not mount twice when the same slug\'s snippet is pasted twice', () => {
    loadWidget()
    new Function(source)()
    expect(document.querySelectorAll('#tf-embed-bubble-acme')).toHaveLength(1)
  })

  it('mounts a SECOND widget when a different concierge\'s snippet is on the same page (regression: used to be silently dropped)', () => {
    // Coaches with 2+ concierges are told to paste each snippet into the same
    // site-wide "custom code" field — the double-mount guard must key on
    // slug, not a fixed element id, or the second concierge's chat never appears.
    loadWidget({}, 'acme')
    loadWidget({}, 'beta-coaching')
    expect(document.getElementById('tf-embed-bubble-acme')).not.toBeNull()
    expect(document.getElementById('tf-embed-bubble-beta-coaching')).not.toBeNull()

    // Each opens its own correct iframe independently.
    document.getElementById('tf-embed-bubble-beta-coaching')!.click()
    const betaFrame = document.getElementById('tf-embed-frame-beta-coaching') as HTMLIFrameElement
    expect(betaFrame.src).toBe('https://2fronts.de/c/beta-coaching?embed=1')
    expect(document.getElementById('tf-embed-panel-acme')!.classList.contains('tf-embed-open')).toBe(false)
  })

  it('slides in the dezente Einladung once, after the delay, then hides it again', () => {
    vi.useFakeTimers()
    loadWidget()
    const invite = document.getElementById('tf-embed-invite-acme')!
    // At rest: present in the DOM but not shown (zero-footprint nudge).
    expect(invite).not.toBeNull()
    expect(invite.classList.contains('tf-embed-invite-in')).toBe(false)
    expect(invite.textContent).toContain('Erstgespräch buchen?')

    // Appears after the default 4s beat, and marks the session so it won't nag again.
    vi.advanceTimersByTime(4000)
    expect(invite.classList.contains('tf-embed-invite-in')).toBe(true)
    expect(sessionStorage.getItem('tf-embed-invited:acme')).toBe('1')

    // It never lingers: slides back out on its own.
    vi.advanceTimersByTime(5000)
    expect(invite.classList.contains('tf-embed-invite-in')).toBe(false)
  })

  it('opens the chat when the invite itself is clicked', () => {
    vi.useFakeTimers()
    loadWidget()
    vi.advanceTimersByTime(4000)
    document.getElementById('tf-embed-invite-acme')!.click()
    expect(document.getElementById('tf-embed-panel-acme')!.classList.contains('tf-embed-open')).toBe(true)
  })

  it('honors data-invite-delay, and falls back to 4s on a garbage value', () => {
    vi.useFakeTimers()
    loadWidget({ 'data-invite-delay': '10' })
    const invite = document.getElementById('tf-embed-invite-acme')!
    // Not yet at the default 4s beat — the custom delay is in charge.
    vi.advanceTimersByTime(4000)
    expect(invite.classList.contains('tf-embed-invite-in')).toBe(false)
    vi.advanceTimersByTime(6000)
    expect(invite.classList.contains('tf-embed-invite-in')).toBe(true)

    // A garbage delay must not break the nudge — it falls back to the 4s default.
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    sessionStorage.clear()
    delete (window as unknown as { __tfEmbedMounted?: unknown }).__tfEmbedMounted
    loadWidget({ 'data-invite-delay': 'soon' })
    vi.advanceTimersByTime(4000)
    expect(document.getElementById('tf-embed-invite-acme')!.classList.contains('tf-embed-invite-in')).toBe(true)
  })

  it('cancels the pending invite when the visitor opens the chat first', () => {
    vi.useFakeTimers()
    loadWidget()
    // The visitor opens (and even closes) the chat before the 4s beat —
    // the nudge is retired for the whole session, it must never pop later.
    document.getElementById('tf-embed-bubble-acme')!.click()
    document.getElementById('tf-embed-close-acme')!.click()
    expect(sessionStorage.getItem('tf-embed-invited:acme')).toBe('1')

    vi.advanceTimersByTime(20000)
    expect(document.getElementById('tf-embed-invite-acme')!.classList.contains('tf-embed-invite-in')).toBe(false)
  })

  it('shows the invite at most once per browser session', () => {
    vi.useFakeTimers()
    loadWidget()
    vi.advanceTimersByTime(4000)
    expect(document.getElementById('tf-embed-invite-acme')!.classList.contains('tf-embed-invite-in')).toBe(true)

    // A fresh page view in the same session: the flag suppresses the nudge.
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    delete (window as unknown as { __tfEmbedMounted?: unknown }).__tfEmbedMounted
    loadWidget()
    vi.advanceTimersByTime(10000)
    expect(document.getElementById('tf-embed-invite-acme')!.classList.contains('tf-embed-invite-in')).toBe(false)
  })

  it('does not show the invite when data-invite="off"', () => {
    vi.useFakeTimers()
    loadWidget({ 'data-invite': 'off' })
    vi.advanceTimersByTime(10000)
    expect(document.getElementById('tf-embed-invite-acme')!.classList.contains('tf-embed-invite-in')).toBe(false)
    // Silenced without side effects: the session flag was never set either.
    expect(sessionStorage.getItem('tf-embed-invited:acme')).toBeNull()
  })

  it('suppresses the gentle invite when data-auto-open force-opens the chat', () => {
    vi.useFakeTimers()
    loadWidget({ 'data-auto-open': '5' })
    vi.advanceTimersByTime(10000)
    // The stronger nudge wins; the two never fire together.
    expect(document.getElementById('tf-embed-panel-acme')!.classList.contains('tf-embed-open')).toBe(true)
    expect(document.getElementById('tf-embed-invite-acme')!.classList.contains('tf-embed-invite-in')).toBe(false)
  })

  it('auto-opens after data-auto-open seconds, but only once per session', () => {
    vi.useFakeTimers()
    loadWidget({ 'data-auto-open': '5' })
    const panel = document.getElementById('tf-embed-panel-acme')!
    expect(panel.classList.contains('tf-embed-open')).toBe(false)

    vi.advanceTimersByTime(5000)
    expect(panel.classList.contains('tf-embed-open')).toBe(true)
    expect(sessionStorage.getItem('tf-embed-auto-opened:acme')).toBe('1')

    // A "new page view" in the same session: the flag suppresses the auto-open.
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    delete (window as unknown as { __tfEmbedMounted?: unknown }).__tfEmbedMounted
    loadWidget({ 'data-auto-open': '5' })
    vi.advanceTimersByTime(10000)
    expect(document.getElementById('tf-embed-panel-acme')!.classList.contains('tf-embed-open')).toBe(
      false,
    )
  })
})
