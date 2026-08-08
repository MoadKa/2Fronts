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
import {
  buildConsentNotice,
  buildConsentSubmission,
  CONSENT_NOTICE_VERSION,
  type ConsentLocale,
  type ConsentNotice,
} from '../../lib/consent'
import { useDocumentMeta } from '../../hooks/useDocumentMeta'
import './ConciergePublicPage.css'

// Light client-side email check; the server validates authoritatively.
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

// The "just looking" control button. Must stay in step with CONTROL.skipContact
// in supabase/functions/concierge-chat/index.ts; the server ignores any control
// id it does not recognise, so a typo here fails silently as "nothing happened".
const SKIP_CONTACT_ID = '__skip_contact__'

// The checkbox's aria-describedby target. The five-sentence notice is NOT inside
// the <label> — see ConsentNotice below for why — so this id is the only thing
// tying the two together for a screen reader.
const CONSENT_NOTICE_ID = 'concierge-consent-notice'

// The one word inside the locked notice that becomes a link. This is a LOCATOR,
// not a copy of the text: the notice itself is never retyped here, it is sliced
// around this substring so the rendered textContent stays byte-identical to what
// buildConsentNotice returned (and therefore to what the server re-renders).
// ConciergePublicPage.test.tsx asserts that equality.
const CONSENT_PRIVACY_TERM: Record<ConsentLocale, string> = {
  de: 'Datenschutzerklärung',
  en: 'privacy policy',
}

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
  // The follow-up consent tick. Starts false and is never seeded from anything —
  // a pre-ticked box is not a consent under Art. 4 Nr. 11 DSGVO.
  const [consentChecked, setConsentChecked] = useState(false)
  // Has the intro probe finished, either way? This is NOT the same question as
  // "did it succeed". `contactMode` starts true, so on first paint the name/email
  // form is already usable while `businessName` and `pageLang` are still null —
  // which is exactly the window in which the consent box cannot exist yet. A
  // visitor who submits in that window would be denied the choice altogether, so
  // the submit button waits for the probe. Set in the .then AND the .catch: a
  // broken probe must cost the checkbox, never the conversation.
  const [probeSettled, setProbeSettled] = useState(false)

  // Ask which language this concierge speaks. A failing probe is not fatal: the
  // page stays in the browser language and the chat still works. Only a genuine
  // unknown/paused slug flips to the unavailable screen — and doing it here means
  // a dead link says so immediately instead of after the visitor types.
  useEffect(() => {
    if (!slug) return
    let cancelled = false
    // A slug change starts a fresh probe, so the previous one's verdict no longer
    // settles anything: back to "waiting" until this one answers.
    setProbeSettled(false)
    fetchConciergeIntro(slug)
      .then((intro) => {
        if (cancelled) return
        // Always record it, even when it matches the browser: `pageLang` also
        // drives the document's lang attribute, and skipping the update when the
        // two agree left an English page on a German document.
        setPageLang(intro.language)
        setBusinessName(intro.business_name)
        setIsDemo(intro.is_demo)
        setProbeSettled(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Settled means answered, not answered well. Without this line a probe
        // that fails for every visitor would leave the submit button disabled
        // forever and take the whole page down with the checkbox.
        setProbeSettled(true)
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

  // The consent wording for THIS page, or null when there is nothing safe to
  // render. Null while the probe is in flight (no business name yet) and null
  // forever if the probe failed — in both cases the page shows no checkbox at
  // all, because a consent box that names no sender is not a consent box. The
  // wording itself lives in src/lib/consent.ts and is mirrored byte for byte by
  // the edge function; nothing here retypes it.
  const consentNotice = useMemo<ConsentNotice | null>(
    () => (pageLang ? buildConsentNotice(CONSENT_NOTICE_VERSION, pageLang, businessName) : null),
    [pageLang, businessName],
  )

  // If the notice the visitor is looking at ever changes underneath them — a
  // late probe for a different slug, a renamed business — the tick they gave is
  // about a sentence that is no longer on screen. Drop it and let them decide
  // again. Also the belt to the braces on "never true on first render".
  const consentIdentity = consentNotice
    ? `${consentNotice.version}|${consentNotice.locale}|${consentNotice.rendered_business_name}`
    : null
  useEffect(() => {
    setConsentChecked(false)
  }, [consentIdentity])

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
    if (!name || !isEmail(email) || !slug || sending || !probeSettled) return
    // Null when the box is unticked OR when no notice was rendered. Both mean
    // "no consent", and both must leave the `consent` key ABSENT from the
    // payload — not present-and-empty, which would be a different claim.
    const consent = buildConsentSubmission(consentChecked, consentNotice)
    setMessages((prev) => [...prev, { role: 'user', content: `${name} · ${email}` }])
    setContactMode(false)
    setSending(true)
    try {
      const reply = await sendConciergeMessage(slug, sessionRef.current, name, undefined, undefined, {
        name,
        email,
        ...(consent ? { consent } : {}),
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

  // "Just looking for now": leave the opening contact form without giving an
  // address. Sends the skip control button the server guards on `phase ===
  // 'contact'`; nothing is stored, no consent row is written, and the visitor
  // lands on the same first gate a contacted visitor sees.
  async function handleSkipContact() {
    if (!slug || sending) return
    const label = t('conciergePublic.contactSkip')
    setMessages((prev) => [...prev, { role: 'user', content: label }])
    setSending(true)
    try {
      const reply = await sendConciergeMessage(slug, sessionRef.current, label, {
        criterion_id: SKIP_CONTACT_ID,
        label,
        qualifies: false,
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: reply.reply }])
      setQuickReplies(reply.quick_replies ?? null)
      setContactMode(reply.request_contact ?? false)
      if (reply.show_booking && reply.calendar_url) setBookingUrl(reply.calendar_url)
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

            {/* The follow-up consent. Optional in every direction: absent until
                the probe names a sender, absent for good if the probe failed,
                and never part of what makes the form submittable. */}
            {consentNotice && (
              <div className="concierge-consent">
                {/* The <label> wraps the input and the ONE-LINE label, nothing
                    else. The notice below is a sibling wired up with
                    aria-describedby: inside the label, a click anywhere in five
                    sentences of explanation would toggle the box, and a consent
                    collected by misclicking explanatory text is not a consent. */}
                <label className="concierge-consent-label">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(e) => setConsentChecked(e.target.checked)}
                    disabled={sending}
                    aria-describedby={CONSENT_NOTICE_ID}
                  />
                  <span>{consentNotice.label}</span>
                </label>
                <ConsentNoticeText notice={consentNotice} />
              </div>
            )}

            <button
              type="submit"
              className="concierge-contact-submit"
              // `probeSettled`, not `businessName`: a failed probe never produces
              // a name, and gating on the name would lock a visitor out of a page
              // that otherwise works perfectly. `consentChecked` is deliberately
              // NOT here — the consent is optional and must never be a toll gate.
              disabled={
                sending || !probeSettled || !contactName.trim() || !isEmail(contactEmail.trim())
              }
            >
              {t('conciergePublic.contactSubmit')}
            </button>
            {/* Leaving without an address. This is not a UX nicety: the consent
                notice tells the visitor the tick is voluntary and that they can
                keep chatting without it, and that is only true if the ADDRESS is
                optional too. A voluntary checkbox on a compulsory email is a
                Kopplung, and an unlawful collection makes the consent to mail it
                moot. Rendered as a button, not a link, because it performs an
                action rather than navigating. */}
            <button
              type="button"
              className="concierge-contact-skip"
              onClick={handleSkipContact}
              disabled={sending}
            >
              {t('conciergePublic.contactSkip')}
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

        {/* Legal surface. Art. 13 DSGVO: the follow-up consent on this page points
            at the Datenschutzerklärung, so the page has to actually reach it —
            a consent linking a page nobody can open is not an informed one.
            Labels come from the legal pages' own titles, so they follow the
            probe-pinned language the same way the rest of the chrome does.
            New tab on purpose: this chat holds no state a reload can restore. */}
        <footer className="concierge-legal">
          <a href="/datenschutz" target="_blank" rel="noopener noreferrer">
            {t('legal.datenschutz.title')}
          </a>
          <a href="/impressum" target="_blank" rel="noopener noreferrer">
            {t('legal.impressum.title')}
          </a>
        </footer>
      </div>
    </div>
  )
}

/**
 * The five-sentence consent notice, with its one reference to the
 * Datenschutzerklärung turned into a real link.
 *
 * The text is NOT retyped here and must never be. It arrives as one locked
 * string from buildConsentNotice, and this only SLICES it: everything before the
 * word, the word inside an <a>, everything after. Concatenated, the three pieces
 * are the original string character for character — which is what makes the
 * server's re-render of the same wording a valid description of this screen.
 * ConciergePublicPage.test.tsx asserts that equality, so an "improvement" typed
 * into the JSX fails the suite instead of quietly invalidating the evidence.
 *
 * If the word is ever missing (a reworded notice, a new locale), the whole
 * string still renders, just without the link — degraded, never mangled.
 */
function ConsentNoticeText({ notice }: { notice: ConsentNotice }) {
  const term = CONSENT_PRIVACY_TERM[notice.locale]
  const at = notice.notice.indexOf(term)
  const children =
    at < 0
      ? notice.notice
      : [
          notice.notice.slice(0, at),
          // New tab on purpose: this chat holds no state a reload can restore,
          // so sending a reader away would cost them the conversation.
          <a key="privacy" href="/datenschutz" target="_blank" rel="noopener noreferrer">
            {term}
          </a>,
          notice.notice.slice(at + term.length),
        ]
  return (
    <p className="concierge-consent-notice" id={CONSENT_NOTICE_ID}>
      {children}
    </p>
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
