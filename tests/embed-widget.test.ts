import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// public/embed.js is the dependency-free widget a coach pastes into their own
// website. It is not part of the Vite build, so we exercise it here by
// evaluating the file inside jsdom with a fake host page.

const source = readFileSync(resolve(__dirname, '../public/embed.js'), 'utf8')

function loadWidget(attrs: Record<string, string> = {}) {
  const script = document.createElement('script')
  script.src = 'https://2fronts.de/embed.js'
  script.setAttribute('data-concierge', 'acme')
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v)
  document.body.appendChild(script)
  // document.currentScript is null when eval'ing, so the widget uses its
  // querySelector('script[data-concierge]') fallback — exactly the tag above.
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
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the chat bubble with an aria-label and no iframe yet', () => {
    loadWidget()
    const bubble = document.getElementById('tf-embed-bubble')
    expect(bubble).not.toBeNull()
    expect(bubble!.getAttribute('aria-label')).toBe('Chat öffnen')
    expect(bubble!.getAttribute('aria-expanded')).toBe('false')
    // The iframe is lazy: nothing loads until the visitor opens the chat.
    expect(document.getElementById('tf-embed-frame')).toBeNull()
  })

  it('opens on click with an iframe pointing at the script origin /c/<slug>?embed=1', () => {
    loadWidget()
    document.getElementById('tf-embed-bubble')!.click()

    const panel = document.getElementById('tf-embed-panel')!
    expect(panel.classList.contains('tf-embed-open')).toBe(true)
    const frame = document.getElementById('tf-embed-frame') as HTMLIFrameElement
    expect(frame.src).toBe('https://2fronts.de/c/acme?embed=1')
    expect(document.getElementById('tf-embed-bubble')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('closes on second bubble click, on the × button, and on Escape', () => {
    loadWidget()
    const bubble = document.getElementById('tf-embed-bubble')!
    const panel = document.getElementById('tf-embed-panel')!

    bubble.click()
    bubble.click() // second click closes
    expect(panel.classList.contains('tf-embed-open')).toBe(false)

    bubble.click()
    document.getElementById('tf-embed-close')!.click()
    expect(panel.classList.contains('tf-embed-open')).toBe(false)

    bubble.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(panel.classList.contains('tf-embed-open')).toBe(false)
  })

  it('applies data-color to the bubble styles', () => {
    loadWidget({ 'data-color': '#123456' })
    const style = document.getElementById('tf-embed-style')!
    expect(style.textContent).toContain('background:#123456')
  })

  it('does nothing without a data-concierge slug', () => {
    const script = document.createElement('script')
    script.src = 'https://2fronts.de/embed.js'
    document.body.appendChild(script)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new Function(source)()
    expect(document.getElementById('tf-embed-bubble')).toBeNull()
    warn.mockRestore()
  })

  it('does not mount twice when the snippet is pasted twice', () => {
    loadWidget()
    new Function(source)()
    expect(document.querySelectorAll('#tf-embed-bubble')).toHaveLength(1)
  })

  it('auto-opens after data-auto-open seconds, but only once per session', () => {
    vi.useFakeTimers()
    loadWidget({ 'data-auto-open': '5' })
    const panel = document.getElementById('tf-embed-panel')!
    expect(panel.classList.contains('tf-embed-open')).toBe(false)

    vi.advanceTimersByTime(5000)
    expect(panel.classList.contains('tf-embed-open')).toBe(true)
    expect(sessionStorage.getItem('tf-embed-auto-opened:acme')).toBe('1')

    // A "new page view" in the same session: the flag suppresses the auto-open.
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    loadWidget({ 'data-auto-open': '5' })
    vi.advanceTimersByTime(10000)
    expect(document.getElementById('tf-embed-panel')!.classList.contains('tf-embed-open')).toBe(
      false,
    )
  })
})
