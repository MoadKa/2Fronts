import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listPublicConnectors } from '../../services/ConnectorService'
import { Reveal } from '../../components/ui/Reveal'
import type { Connector } from '../../types/database'
import './SupportedSoftwarePage.css'

// A short monogram for the logo tile, derived from the display name so new
// registry rows render without extra assets. First letter of the first two
// words (splitting on spaces and slashes); falls back to the first two letters.
function monogram(displayName: string): string {
  const words = displayName.split(/[\s/]+/).filter(Boolean)
  const initials = words.map((w) => w[0]).join('')
  return (initials.length >= 2 ? initials.slice(0, 2) : displayName.slice(0, 2)).toUpperCase()
}

export function SupportedSoftwarePage() {
  const { t } = useTranslation()
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    listPublicConnectors()
      .then((data) => setConnectors(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="software-page">
      <div className="page-header">
        <h1>{t('supportedSoftware.title')}</h1>
        <p>{t('supportedSoftware.intro')}</p>
      </div>

      {loading && <p className="software-status">{t('supportedSoftware.loading')}</p>}
      {!loading && error && (
        <p className="software-status">{t('supportedSoftware.loadError')}</p>
      )}
      {!loading && !error && connectors.length === 0 && (
        <p className="software-status">{t('supportedSoftware.empty')}</p>
      )}

      {!loading && !error && connectors.length > 0 && (
        <div className="software-grid">
          {connectors.map((connector, index) => {
            const isLive = connector.status === 'live'
            return (
              <Reveal key={connector.connector_type} delay={index * 40}>
                <div className={isLive ? 'software-card' : 'software-card software-card-soon'}>
                  <span className="software-card-status">
                    {isLive ? (
                      <span className="pill pill-live">{t('supportedSoftware.available')}</span>
                    ) : (
                      <span className="pill pill-soon">{t('supportedSoftware.soon')}</span>
                    )}
                  </span>
                  <div className="software-logo" aria-hidden="true">
                    {monogram(connector.display_name)}
                  </div>
                  <div className="software-name">{connector.display_name}</div>
                  {connector.category && <div className="software-cat">{connector.category}</div>}
                </div>
              </Reveal>
            )
          })}
        </div>
      )}
    </div>
  )
}
