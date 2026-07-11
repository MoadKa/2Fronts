import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { sendConciergeMessage, newSessionId } from '../../services/ConciergeService'
import type { QualOption, QualPrompt } from '../../lib/qualification'
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
  const { t } = useTranslation()
  // ?embed=1: the page runs inside the small widget iframe from public/embed.js,
  // so the standalone-page breathing room goes away and the chat fills the frame.
  const [searchParams] = useSearchParams()
  const isEmbed = searchParams.get('embed') === '1'
  const wrapClass = `concierge-wrap${isEmbed ? ' concierge-wrap--embed' : ''}`

  // One stable per-visitor session id for the whole page lifetime, so the AI
  // follows the thread across messages.
  const sessionId = useMemo(() => newSessionId(), [])
  const sessionRef = useRef(sessionId)

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: t('conciergePublic.greeting') },
  ])
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

  // Apply the unavailable/error handling shared by text + quick-reply sends.
  function handleSendError(err: unknown) {
    const key = err instanceof Error ? err.message : 'conciergeChat.error'
    // An unknown/inactive slug -> a calm dedicated screen, never a crash.
    if (key === 'conciergeChat.unavailable') {
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
          {messages.map((m, i) => (
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
