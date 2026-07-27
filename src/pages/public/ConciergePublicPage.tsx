import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  sendConciergeMessage,
  newSessionId,
  fetchConciergeIntro,
  CONCIERGE_UNAVAILABLE,
  CONCIERGE_ERROR,
  type ConciergeLanguage,
} from '../../services/ConciergeService'
import type { QualOption, QualPrompt } from '../../lib/qualification'
import { useDocumentMeta } from '../../hooks/useDocumentMeta'
import './ConciergePublicPage.css'

// Light client-side email check; the server validates authoritatively.
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

// The public face of the AI Booking Concierge (#23): a no-auth chat at /c/:slug.
// A visitor types, the AI answers (grounded only in the coach's content,
// server-side), and a booking CTA appears when the AI surfaces the calendar
// link. The coach's offer/qa never reach this page — only replies + the link.

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export function ConciergePublicPage() {
  const { slug } = useParams<{ slug: string }>()
  const { t: tBrowser, i18n } = useTranslation()
  // The coach configured a language for this concierge, and the AI always replies
  // in it. The page's OWN chrome (welcome line, name/email form, buttons) used to
  // follow the visitor's browser instead, so an English browser saw an English
  // opening screen in front of a German bot. Probe the slug's language and pin
  // the page to it. Null until the probe answers -> browser language, which is
  // the right guess to render immediately.
  const [pageLang, setPageLang] = useState<ConciergeLanguage | null>(null)
  const t = useMemo(
    () => (pageLang ? i18n.getFixedT(pageLang) : tBrowser),
    [pageLang, i18n, tBrowser],
  )
  // The coach's name, for the browser tab. A prospect often gets this link in a
  // DM among many tabs; "Roman Kmenta" beats the app's generic title.
  const [businessName, setBusinessName] = useState<string | null>(null)
  // A demo concierge was built for a prospect, not by them. The page speaks as
  // their business, so it says so — out loud, on the page itself, not only in
  // whatever message the link arrived in.
  const [isDemo, setIsDemo] = useState(false)
  // ?embed=1: the page runs inside the small widget iframe from public/embed.js,
  // so the standalone-page breathing room goes away and the chat fills the frame.
  const [searchParams] = useSearchParams()
  const isEmbed = searchParams.get('embed') === '1'
  const wrapClass = `concierge-wrap${isEmbed ? ' concierge-wrap--embed' : ''}`

  // In embed mode, Escape must close the widget's parent panel — but a
  // cross-origin iframe never receives the host page's keydown events, so
  // embed.js can't listen for it directly. Forward it via postMessage instead;
  // embed.js listens for this exact message shape.
  useEffect(() => {
    if (!isEmbed) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        window.parent.postMessage({ source: 'tf-embed', type: 'escape' }, '*')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isEmbed])

  // One stable per-visitor session id for the whole page lifetime, so the AI
  // follows the thread across messages.
  const sessionId = useMemo(() => newSessionId(), [])
  const sessionRef = useRef(sessionId)

  // Only the turns that actually happened. The opening welcome bubble is derived
  // at render time so it re-renders in the coach's language once the probe lands.
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [bookingUrl, setBookingUrl] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  // The qualification quick-reply prompt to render under the latest assistant
  // bubble, if any. Cleared once the visitor answers it.
  const [quickReplies, setQuickReplies] = useState<QualPrompt | null>(null)
  // The chat OPENS in contact mode: the first thing the visitor sees is the
  // welcome bubble + a name/email form. After they submit, the server returns the
  // opening reply with no `request_contact`, so contactMode flips to false and the
  // normal composer/quick-replies take over. The booking-gate paths can also flip
  // this back on later as a safety net.
  const [contactMode, setContactMode] = useState(true)
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')

  // Ask which language this concierge speaks. A failing probe is not fatal: the
  // page stays in the browser language and the chat still works. Only a genuine
  // unknown/paused slug flips to the unavailable screen — and doing it here means
  // a dead link says so immediately instead of after the visitor types.
  useEffect(() => {
    if (!slug) return
    let cancelled = false
    fetchConciergeIntro(slug)
      .then((intro) => {
        if (cancelled) return
        // Always record it, even when it matches the browser: `pageLang` also
        // drives the document's lang attribute, and skipping the update when the
        // two agree left an English page on a German document.
        setPageLang(intro.language)
        setBusinessName(intro.business_name)
        setIsDemo(intro.is_demo)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof Error && err.message === CONCIERGE_UNAVAILABLE) {
          setUnavailable(true)
          return
        }
        // Everything else degrades to the browser language on purpose. Log it:
        // silently swallowed, a probe that is broken for EVERY visitor (a lagging
        // edge-function deploy, say) looks like nothing at all from the outside.
        console.warn('[concierge] language probe failed, falling back to browser language', err)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  // Keep the document language in step, so screen readers pronounce the chat in
  // the language it is actually written in.
  useEffect(() => {
    if (!pageLang) return
    const previous = document.documentElement.lang
    document.documentElement.lang = pageLang
    return () => {
      document.documentElement.lang = previous
    }
  }, [pageLang])

  // Keep this route OUT of search results. Not optional: a concierge is a
  // per-visitor chat surface, not content anyone should reach from a search —
  // and a DEMO concierge is a page on 2Fronts' domain speaking as a named real
  // person's business. Both demos that existed when this was added were
  // indexable. No title here; the effect below owns it (embed mode differs).
  useDocumentMeta({ noindex: true })

  // Name the tab after the coach. Skipped in embed mode: the widget's iframe has
  // its own document whose title is never shown, so there is nothing to name.
  useEffect(() => {
    if (!businessName || isEmbed) return
    const previous = document.title
    document.title = businessName
    return () => {
      document.title = previous
    }
  }, [businessName, isEmbed])

  // Apply the unavailable/error handling shared by text + quick-reply sends.
  function handleSendError(err: unknown) {
    const key = err instanceof Error ? err.message : CONCIERGE_ERROR
    // An unknown/inactive slug -> a calm dedicated screen, never a crash.
    if (key === CONCIERGE_UNAVAILABLE) {
      setUnavailable(true)
    } else {
      setMessages((prev) => [...prev, { role: 'assistant', content: t('conciergeChat.error') }])
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || !slug || sending) return

    // Optimistically show the visitor's message, then ask the AI.
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    setSending(true)
    try {
      // If a quick-reply question is pending and the visitor TYPED instead of
      // tapping, pass that criterion id so the server interprets the text against
      // it (matched option / off-menu answer / a real question) rather than
      // silently dropping it and re-asking forever. We do NOT optimistically clear
      // the buttons: the server response drives them (it advances or re-asks).
      const reply = await sendConciergeMessage(
        slug,
        sessionRef.current,
        text,
        undefined,
        quickReplies?.criterion_id,
      )
      setMessages((prev) => [...prev, { role: 'assistant', content: reply.reply }])
      if (reply.show_booking && reply.calendar_url) setBookingUrl(reply.calendar_url)
      // Render the next qualification prompt as buttons (or clear if none).
      setQuickReplies(reply.quick_replies ?? null)
      setContactMode(reply.request_contact ?? false)
    } catch (err) {
      handleSendError(err)
    } finally {
      setSending(false)
    }
  }

  // Visitor submitted the name/email form: send it as the contact, show a
  // confirming bubble, and process the booking reply that comes back.
  async function handleContactSubmit(e: FormEvent) {
    e.preventDefault()
    const name = contactName.trim()
    const email = contactEmail.trim()
    if (!name || !isEmail(email) || !slug || sending) return
    setMessages((prev) => [...prev, { role: 'user', content: `${name} · ${email}` }])
    setContactMode(false)
    setSending(true)
    try {
      const reply = await sendConciergeMessage(slug, sessionRef.current, name, undefined, undefined, { name, email })
      setMessages((prev) => [...prev, { role: 'assistant', content: reply.reply }])
      if (reply.show_booking && reply.calendar_url) setBookingUrl(reply.calendar_url)
      setQuickReplies(reply.quick_replies ?? null)
      setContactMode(reply.request_contact ?? false)
    } catch (err) {
      handleSendError(err)
    } finally {
      setSending(false)
    }
  }

  // Visitor clicked a quick-reply button: optimistically show its label as a user
  // bubble, send the chosen answer (no free-text), and render the next prompt.
  async function handleQuickReply(prompt: QualPrompt, option: QualOption) {
    if (!slug || sending) return
    setMessages((prev) => [...prev, { role: 'user', content: option.label }])
    setQuickReplies(null) // hide the answered prompt immediately
    setSending(true)
    try {
      const reply = await sendConciergeMessage(slug, sessionRef.current, option.label, {
        criterion_id: prompt.criterion_id,
        label: option.label,
        qualifies: option.qualifies,
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: reply.reply }])
      if (reply.show_booking && reply.calendar_url) setBookingUrl(reply.calendar_url)
      setQuickReplies(reply.quick_replies ?? null)
      setContactMode(reply.request_contact ?? false)
    } catch (err) {
      handleSendError(err)
    } finally {
      setSending(false)
    }
  }

  if (unavailable) {
    return (
      <div className={wrapClass}>
        <div className="concierge-unavailable">
          <h1>{t('conciergePublic.unavailableTitle')}</h1>
          <p>{t('conciergePublic.unavailableBody')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={wrapClass}>
      <div className="concierge-chat">
        <div className="concierge-messages" aria-live="polite">
          {[{ role: 'assistant' as const, content: t('conciergePublic.greeting') }, ...messages].map((m, i) => (
            <div key={i} className={`concierge-row concierge-row-${m.role} rise`}>
              {m.role === 'assistant' && (
                <span className="concierge-avatar" aria-hidden="true">
                  <SparkIcon />
                </span>
              )}
              <div className={`concierge-bubble concierge-bubble-${m.role}`}>{m.content}</div>
            </div>
          ))}
          {sending && (
            <div className="concierge-row concierge-row-assistant rise">
              <span className="concierge-avatar" aria-hidden="true">
                <SparkIcon />
              </span>
              {/* Animated dots typing indicator. The localized "thinking" text is
                  kept for screen readers via an offscreen label. */}
              <div className="concierge-bubble concierge-bubble-assistant concierge-typing">
                <span className="concierge-sr-only">{t('conciergePublic.thinking')}</span>
                <span className="concierge-dots" aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              </div>
            </div>
          )}

          {quickReplies && !sending && (
            <div className="concierge-quick-replies rise">
              {/* The bot asks the question in its own reply above; these are just
                  the answer options. aria-label keeps the group labelled for SR. */}
              <div className="concierge-quick-options" role="group" aria-label={quickReplies.question}>
                {quickReplies.options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    className="concierge-quick-option"
                    onClick={() => handleQuickReply(quickReplies, opt)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {bookingUrl && (
          <div className="concierge-booking rise">
            <a className="concierge-book-cta" href={bookingUrl} target="_blank" rel="noopener noreferrer">
              <CalendarIcon />
              {t('conciergePublic.bookCta')}
            </a>
          </div>
        )}

        {contactMode ? (
          <form className="concierge-contact" onSubmit={handleContactSubmit}>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder={t('conciergePublic.namePlaceholder')}
              aria-label={t('conciergePublic.namePlaceholder')}
              autoComplete="name"
              disabled={sending}
            />
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder={t('conciergePublic.emailPlaceholder')}
              aria-label={t('conciergePublic.emailPlaceholder')}
              autoComplete="email"
              disabled={sending}
            />
            <button
              type="submit"
              className="concierge-contact-submit"
              disabled={sending || !contactName.trim() || !isEmail(contactEmail.trim())}
            >
              {t('conciergePublic.contactSubmit')}
            </button>
          </form>
        ) : (
          <form className="concierge-input" onSubmit={handleSend}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('conciergePublic.inputPlaceholder')}
              aria-label={t('conciergePublic.inputPlaceholder')}
              disabled={sending}
            />
            <button
              type="submit"
              className="concierge-send"
              disabled={sending || !input.trim()}
              aria-label={t('conciergePublic.send')}
            >
              {sending ? t('conciergePublic.sending') : <SendIcon />}
            </button>
          </form>
        )}

        {/* Demo disclosure. Rendered in embed mode too: the widget iframe is
            exactly where a prospect meets this, so hiding it there would hide it
            from the only audience that needs it. */}
        {isDemo && (
          <p className="concierge-demo-note">{t('conciergePublic.demoNote')}</p>
        )}

        {isEmbed && (
          <a
            className="concierge-powered"
            href="https://2fronts.de/?utm_source=widget&utm_medium=embed"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('conciergePublic.poweredBy')}
          </a>
        )}
      </div>
    </div>
  )
}

// --- Inline SVG icons (no emoji), sized to inherit currentColor. -------------

function SparkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}
