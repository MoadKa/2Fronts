import { useEffect, useState, type SVGProps } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  listSlackChannels,
  confirmSlackChannel,
  type SlackChannel,
} from '../../services/SlackService'
import './MappingConfirmationPage.css'
import './SlackChannelPage.css'

function CheckCircleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className="ic"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </svg>
  )
}

// The Slack equivalent of MappingConfirmationPage: after the customer connects
// Slack for a slack_notifications provision, list their channels, let them pick
// one, and persist the choice (config.channelId) so lead notifications post
// there. Loading / empty / error / success states are all handled.
export function SlackChannelPage() {
  const { provisionId } = useParams<{ provisionId: string }>()
  const { t } = useTranslation()

  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!provisionId) return
    listSlackChannels(provisionId)
      .then((rows) => setChannels(rows))
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'slackConnect.errors.generic'))
      .finally(() => setLoading(false))
  }, [provisionId])

  // Retry handler for the error / empty states. Unlike the initial mount (which
  // already starts with loading=true) this flips the spinner back on first.
  function retryLoad() {
    if (!provisionId) return
    setLoading(true)
    setLoadError(null)
    listSlackChannels(provisionId)
      .then((rows) => setChannels(rows))
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'slackConnect.errors.generic'))
      .finally(() => setLoading(false))
  }

  async function handleConfirm() {
    if (!provisionId || !selected) return
    setSaving(true)
    setSaveError(null)
    const channelName = channels.find((c) => c.id === selected)?.name ?? null
    try {
      await confirmSlackChannel(provisionId, selected, channelName)
      setDone(true)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'slackConnect.errors.generic')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mapping-wrap">
        <p>{t('slackConnect.loading')}</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mapping-wrap">
        <div className="mapping-card">
          <h1>{t('slackConnect.title')}</h1>
          <p style={{ color: 'var(--color-destructive)' }}>{t(loadError)}</p>
          <div className="mapping-actions">
            <button type="button" className="btn btn-primary" onClick={retryLoad}>
              {t('slackConnect.retry')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (done) {
    const channelName = channels.find((c) => c.id === selected)?.name ?? selected
    return (
      <div className="mapping-wrap">
        <div className="mapping-card">
          <div className="reassure slack-success">
            <CheckCircleIcon />
            <span>{t('slackConnect.successBody', { channel: channelName })}</span>
          </div>
          <h1>{t('slackConnect.successTitle')}</h1>
        </div>
      </div>
    )
  }

  if (channels.length === 0) {
    return (
      <div className="mapping-wrap">
        <div className="mapping-card">
          <h1>{t('slackConnect.title')}</h1>
          <p className="muted">{t('slackConnect.emptyBody')}</p>
          <div className="mapping-actions">
            <button type="button" className="btn btn-primary" onClick={retryLoad}>
              {t('slackConnect.retry')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mapping-wrap">
      <div className="mapping-card">
        <h1>{t('slackConnect.title')}</h1>
        <p className="muted">{t('slackConnect.body')}</p>

        <ul className="slack-channel-list">
          {channels.map((channel) => (
            <li key={channel.id}>
              <label className="slack-channel-row">
                <input
                  type="radio"
                  name="slack-channel"
                  value={channel.id}
                  checked={selected === channel.id}
                  onChange={() => setSelected(channel.id)}
                />
                <span className="slack-channel-name">#{channel.name}</span>
              </label>
            </li>
          ))}
        </ul>

        {saveError && <p style={{ color: 'var(--color-destructive)' }}>{t(saveError)}</p>}

        <div className="mapping-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selected || saving}
            onClick={handleConfirm}
          >
            {saving ? t('slackConnect.saving') : t('slackConnect.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
