import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getProvisionConnectorType } from '../../services/SlackService'
import { MappingConfirmationPage } from './MappingConfirmationPage'
import { SlackChannelPage } from './SlackChannelPage'

// Single entry point for /connect/:provisionId/confirm. Both the Google and Slack
// OAuth callbacks redirect here; we read the provision's connector_type once and
// render the matching first-connect screen:
//   google_sheets       -> column-mapping confirmation (existing)
//   slack_notifications -> Slack channel picker (#16)
// Unknown / unreadable types fall back to the mapping screen, which has its own
// error handling, so no provision dead-ends on a blank page.
export function ConnectConfirmRoute() {
  const { provisionId } = useParams<{ provisionId: string }>()
  const { t } = useTranslation()
  const [connectorType, setConnectorType] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!provisionId) return
    let active = true
    getProvisionConnectorType(provisionId)
      .then((type) => {
        if (active) setConnectorType(type)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [provisionId])

  if (loading) {
    return (
      <div className="mapping-wrap">
        <p>{t('slackConnect.loading')}</p>
      </div>
    )
  }

  if (connectorType === 'slack_notifications') {
    return <SlackChannelPage />
  }

  // google_sheets (and any other / unknown type) -> the mapping confirmation
  // screen, which handles its own loading and error states.
  return <MappingConfirmationPage />
}
