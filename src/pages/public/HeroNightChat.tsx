import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './HeroNightChat.css'

/**
 * The lost-inquiry chat (DESIGN.md, hero act 1): a prospect writes Tuesday
 * 23:12, the coach replies Wednesday morning, the Thursday follow-up lands
 * after she already booked elsewhere. Plays out like a real messenger,
 * ends on the red loss card. The chat script is structured data (bubbles,
 * separators, timestamps), so it lives here rather than in the flat i18n JSON.
 */
type ChatItem =
  | { type: 'sep'; text: string }
  | { type: 'in' | 'out'; text: string; t: string; read?: boolean }
  | { type: 'loss'; title: string; text: string }

const SCRIPTS: Record<'de' | 'en', ChatItem[]> = {
  de: [
    { type: 'sep', text: 'Dienstag' },
    { type: 'in', t: '23:12', text: 'Hallo! Ich interessiere mich für Ihr Coaching. Hätten Sie diese Woche noch einen Termin für ein Erstgespräch frei?' },
    { type: 'sep', text: 'Mittwoch' },
    { type: 'out', t: '08:34', read: false, text: 'Guten Morgen! Gerne, da war ich gestern schon offline. Passt Ihnen Donnerstag 14 Uhr?' },
    { type: 'sep', text: 'Donnerstag' },
    { type: 'out', t: '09:15', read: true, text: 'Kurze Nachfrage: Haben Sie noch Interesse an einem Erstgespräch?' },
    { type: 'in', t: '09:52', text: 'Danke für die Rückmeldung! Ich habe inzwischen bei einem anderen Coach gebucht.' },
    { type: 'loss', title: 'Anfrage verloren', text: 'Reaktionszeit: 9 Std 22 Min · von der Konkurrenz gestohlen' },
  ],
  en: [
    { type: 'sep', text: 'Tuesday' },
    { type: 'in', t: '11:12 PM', text: 'Hi! I am interested in your coaching. Would you have a slot for a discovery call this week?' },
    { type: 'sep', text: 'Wednesday' },
    { type: 'out', t: '8:34 AM', read: false, text: 'Good morning! Happy to chat, I was offline last night. Would Thursday 2pm work for you?' },
    { type: 'sep', text: 'Thursday' },
    { type: 'out', t: '9:15 AM', read: true, text: 'Just following up: are you still interested in a discovery call?' },
    { type: 'in', t: '9:52 AM', text: 'Thanks for getting back to me! I have already booked with another coach in the meantime.' },
    { type: 'loss', title: 'Lead lost', text: 'Response time: 9 hrs 22 min · stolen by a competitor' },
  ],
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function HeroNightChat() {
  const { t, i18n } = useTranslation()
  const lang: 'de' | 'en' = i18n.language.startsWith('en') ? 'en' : 'de'
  const script = SCRIPTS[lang]

  // visible = how many script items have appeared; typing = dots shown before
  // the next incoming bubble. A token guards stale timeouts after replay,
  // language switches, and unmount.
  const [visible, setVisible] = useState(0)
  const [typing, setTyping] = useState(false)
  const tokenRef = useRef(0)
  const msgsRef = useRef<HTMLDivElement>(null)

  const play = useCallback(() => {
    const token = ++tokenRef.current
    if (prefersReducedMotion()) {
      setTyping(false)
      setVisible(script.length)
      return
    }
    setVisible(0)
    setTyping(false)
    let i = 0
    function next() {
      if (token !== tokenRef.current) return
      if (i >= script.length) return
      const item = script[i]!
      const advance = () => {
        if (token !== tokenRef.current) return
        i++
        setVisible(i)
        setTimeout(next, item.type === 'sep' ? 650 : 950 + Math.random() * 550)
      }
      if (item.type === 'in') {
        setTyping(true)
        setTimeout(() => {
          if (token !== tokenRef.current) return
          setTyping(false)
          advance()
        }, 1100 + Math.random() * 600)
      } else {
        advance()
      }
    }
    setTimeout(next, 600)
  }, [script])

  useEffect(() => {
    play()
    return () => {
      // Invalidate pending timeouts on unmount/replay so nothing fires late.
      tokenRef.current++
    }
  }, [play])

  // Real-messenger behavior: newest message stays in view.
  useEffect(() => {
    const el = msgsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visible, typing])

  return (
    <div className="night-scene">
      <div className="night-phone">
        <div className="night-screen">
          <div className="night-island" aria-hidden="true" />
          <div className="night-statusbar" aria-hidden="true">
            <span>{lang === 'en' ? '11:12 PM' : '23:12'}</span>
            <span>▦ ▲ ▮▮▮</span>
          </div>
          <div className="night-chat-head">
            <span className="night-back" aria-hidden="true">‹</span>
            <span className="night-avatar" aria-hidden="true">SM</span>
            <div className="night-who">
              <b>Sandra M.</b>
              <span>{t('nightHero.lastSeen')}</span>
            </div>
          </div>
          <div className="night-msgs" ref={msgsRef}>
            {script.slice(0, visible).map((item, idx) => {
              if (item.type === 'sep') {
                return <span key={idx} className="night-sep">{item.text}</span>
              }
              if (item.type === 'loss') {
                return (
                  <div key={idx} className="night-loss">
                    <b>{item.title}</b>
                    {item.text}
                  </div>
                )
              }
              return (
                <div key={idx} className={`night-msg night-${item.type}`}>
                  {item.text}
                  <span className="night-meta">
                    {item.t}
                    {item.type === 'out' && (
                      <span className={item.read ? 'night-ticks read' : 'night-ticks'}>✓✓</span>
                    )}
                  </span>
                </div>
              )
            })}
            {typing && (
              <div className="night-typing" aria-hidden="true"><i /><i /><i /></div>
            )}
          </div>
          <div className="night-inputbar" aria-hidden="true">
            <span className="night-field">{t('nightHero.inputHint')}</span>
            <span className="night-mic">🎙</span>
          </div>
        </div>
      </div>
      <button type="button" className="night-replay" onClick={play}>
        {t('nightHero.replay')}
      </button>
    </div>
  )
}
