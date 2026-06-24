import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { sendConciergeMessage, newSessionId } from '../../services/ConciergeService'
import './ConciergePublicPage.css'

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

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || !slug || sending) return

    // Optimistically show the visitor's message, then ask the AI.
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    setSending(true)
    try {
      const reply = await sendConciergeMessage(slug, sessionRef.current, text)
      setMessages((prev) => [...prev, { role: 'assistant', content: reply.reply }])
      if (reply.show_booking && reply.calendar_url) setBookingUrl(reply.calendar_url)
    } catch (err) {
      const key = err instanceof Error ? err.message : 'conciergeChat.error'
      // An unknown/inactive slug -> a calm dedicated screen, never a crash.
      if (key === 'conciergeChat.unavailable') {
        setUnavailable(true)
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: t('conciergeChat.error') }])
      }
    } finally {
      setSending(false)
    }
  }

  if (unavailable) {
    return (
      <div className="concierge-wrap">
        <div className="concierge-unavailable">
          <h1>{t('conciergePublic.unavailableTitle')}</h1>
          <p>{t('conciergePublic.unavailableBody')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="concierge-wrap">
      <div className="concierge-chat">
        <div className="concierge-messages" aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} className={`concierge-bubble concierge-bubble-${m.role}`}>
              {m.content}
            </div>
          ))}
          {sending && <div className="concierge-bubble concierge-bubble-assistant concierge-typing">{t('conciergePublic.thinking')}</div>}
        </div>

        {bookingUrl && (
          <div className="concierge-booking">
            <a className="btn btn-primary" href={bookingUrl} target="_blank" rel="noopener noreferrer">
              {t('conciergePublic.bookCta')}
            </a>
          </div>
        )}

        <form className="concierge-input" onSubmit={handleSend}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('conciergePublic.inputPlaceholder')}
            aria-label={t('conciergePublic.inputPlaceholder')}
            disabled={sending}
          />
          <button type="submit" className="btn btn-primary" disabled={sending || !input.trim()}>
            {sending ? t('conciergePublic.sending') : t('conciergePublic.send')}
          </button>
        </form>
      </div>
    </div>
  )
}
