import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { sendConciergeMessage, newSessionId } from '../../services/ConciergeService'
import type { QualOption, QualPrompt } from '../../lib/qualification'
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
  // The qualification quick-reply prompt to render under the latest assistant
  // bubble, if any. Cleared once the visitor answers it.
  const [quickReplies, setQuickReplies] = useState<QualPrompt | null>(null)

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
      const reply = await sendConciergeMessage(slug, sessionRef.current, text)
      setMessages((prev) => [...prev, { role: 'assistant', content: reply.reply }])
      if (reply.show_booking && reply.calendar_url) setBookingUrl(reply.calendar_url)
      // Render the next qualification prompt as buttons (or clear if none).
      setQuickReplies(reply.quick_replies ?? null)
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
    } catch (err) {
      handleSendError(err)
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

          {quickReplies && !sending && (
            <div className="concierge-quick-replies">
              {/* The bot asks the question in its own reply above; these are just
                  the answer options. aria-label keeps the group labelled for SR. */}
              <div className="concierge-quick-options" role="group" aria-label={quickReplies.question}>
                {quickReplies.options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    className="btn btn-secondary concierge-quick-option"
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
