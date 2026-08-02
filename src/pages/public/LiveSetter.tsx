import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchConciergeIntro } from '../../services/ConciergeService'

// The lit half of the home page, made real: 2Fronts' own production concierge,
// embedded on the page a visitor is reading. It is the same route a coach shares
// with their prospects (/c/:slug?embed=1), same origin, so the whole working
// chat arrives without a second implementation of it.
//
// The slug is configuration, not a constant: set VITE_HOME_CONCIERGE_SLUG to the
// concierge 2Fronts runs for itself. With no slug, or with a slug the chat
// function will not serve, the panel says so in plain words. A page whose entire
// argument is "it answers" must never stage a conversation it cannot have.

const SLUG = import.meta.env.VITE_HOME_CONCIERGE_SLUG as string | undefined

export type LiveSetterStatus = 'probing' | 'live' | 'down'

export function LiveSetter({ onStatus }: { onStatus?: (status: LiveSetterStatus) => void }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<LiveSetterStatus>(SLUG ? 'probing' : 'down')

  // The section's own intro promises the visitor can ask it something, so the
  // page above has to know when that promise cannot be kept.
  useEffect(() => {
    onStatus?.(status)
  }, [status, onStatus])

  useEffect(() => {
    if (!SLUG) return
    let cancelled = false
    // Ask the chat function whether this slug actually serves before framing it.
    // A dead slug inside the iframe would render the concierge's own unavailable
    // screen, which is honest but reads as a broken product on a sales page.
    fetchConciergeIntro(SLUG)
      .then(() => {
        if (!cancelled) setStatus('live')
      })
      .catch(() => {
        if (!cancelled) setStatus('down')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="dg-setter-frame">
      <div className="dg-setter-bar">
        <span>{t('home.setterBar')}</span>
        <span className="dg-time">{status === 'live' ? t('home.setterOn') : t('home.setterOff')}</span>
      </div>

      {status === 'live' && SLUG ? (
        <iframe
          src={`/c/${encodeURIComponent(SLUG)}?embed=1`}
          title={t('home.setterFrameTitle')}
          loading="lazy"
        />
      ) : (
        <div className="dg-setter-down">
          {status === 'probing' ? (
            <>
              <b>{t('home.setterProbingTitle')}</b>
              <p>{t('home.setterProbingBody')}</p>
            </>
          ) : (
            <>
              <b>{t('home.setterDownTitle')}</b>
              <p>{t('home.setterDownBody')}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
