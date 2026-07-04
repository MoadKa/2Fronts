import { useState, type SVGProps } from 'react'
import { useTranslation } from 'react-i18next'
import './DemoVideo.css'

/**
 * Demo video IDs per UI language. Only an English recording exists today, so
 * German falls back to it; swap the `de` entry once the German re-record
 * (video-skript-de) is on Loom.
 */
const DEMO_VIDEO_ID_BY_LANG: Record<string, string> = {
  en: 'e9a02336831845d090081861ca929f0b',
  de: 'e9a02336831845d090081861ca929f0b',
}

function resolveVideoId(language: string): string {
  const base = language.split('-')[0] ?? 'de'
  return DEMO_VIDEO_ID_BY_LANG[base] ?? DEMO_VIDEO_ID_BY_LANG['de']!
}

type IconProps = SVGProps<SVGSVGElement>

function PlayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8.5 5.6v12.8c0 .9 1 1.5 1.8 1l10-6.4c.7-.5.7-1.5 0-2l-10-6.4c-.8-.5-1.8.1-1.8 1z" />
    </svg>
  )
}

function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}

/**
 * Click-to-play demo video. Renders a lightweight, on-brand poster (a chat
 * vignette showing what the setter does) and only mounts the Loom iframe when
 * the visitor actually clicks play — no third-party requests before that.
 */
export function DemoVideo() {
  const { t, i18n } = useTranslation()
  const [playing, setPlaying] = useState(false)
  const videoId = resolveVideoId(i18n.language)

  if (playing) {
    return (
      <div className="demo-video demo-video-live">
        <iframe
          src={`https://www.loom.com/embed/${videoId}?autoplay=1&hide_share=true&hide_title=true&hideEmbedTopBar=true`}
          title={t('demo.videoTitle')}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }

  return (
    <button type="button" className="demo-video demo-video-poster" onClick={() => setPlaying(true)} aria-label={t('demo.playLabel')}>
      <span className="demo-poster-glow" aria-hidden="true" />
      <span className="demo-poster-chat" aria-hidden="true">
        <span className="demo-bubble demo-bubble-prospect">{t('demo.posterProspect')}</span>
        <span className="demo-bubble demo-bubble-setter">{t('demo.posterSetter')}</span>
        <span className="demo-booked-chip">
          <CheckIcon className="demo-booked-icon" />
          {t('demo.posterBooked')}
        </span>
      </span>
      <span className="demo-play-wrap">
        <span className="demo-play-button">
          <PlayIcon className="demo-play-icon" />
        </span>
        <span className="demo-duration-chip">{t('demo.durationChip')}</span>
      </span>
    </button>
  )
}
