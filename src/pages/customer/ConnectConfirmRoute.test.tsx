import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ConnectConfirmRoute } from './ConnectConfirmRoute'
import { getProvisionConnectorType, listSlackChannels } from '../../services/SlackService'
import { getProposedMapping } from '../../services/MappingService'

vi.mock('../../services/SlackService', () => ({
  getProvisionConnectorType: vi.fn(),
  listSlackChannels: vi.fn(),
  confirmSlackChannel: vi.fn(),
}))
vi.mock('../../services/MappingService', () => ({
  getProposedMapping: vi.fn(),
  saveConfirmedMapping: vi.fn(),
}))
vi.mock('../../services/ConnectorService', () => ({
  configureSheet: vi.fn(),
}))

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/connect/prov-1/confirm']}>
      <Routes>
        <Route path="/connect/:provisionId/confirm" element={<ConnectConfirmRoute />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ConnectConfirmRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listSlackChannels).mockResolvedValue([{ id: 'C1', name: 'leads' }])
    vi.mocked(getProposedMapping).mockResolvedValue(null)
  })

  it('renders the Slack channel picker for a slack_notifications provision', async () => {
    vi.mocked(getProvisionConnectorType).mockResolvedValue('slack_notifications')
    renderRoute()
    await waitFor(() => expect(screen.getByText('#leads')).toBeInTheDocument())
    expect(listSlackChannels).toHaveBeenCalledWith('prov-1')
  })

  it('renders the mapping screen for a google_sheets provision', async () => {
    vi.mocked(getProvisionConnectorType).mockResolvedValue('google_sheets')
    renderRoute()
    // The mapping page's sheet picker appears (no proposed mapping yet).
    await waitFor(() =>
      expect(screen.getByText(/Mit welcher Tabelle sollen wir arbeiten/i)).toBeInTheDocument(),
    )
    expect(listSlackChannels).not.toHaveBeenCalled()
  })

  it('falls back to the mapping screen for an unknown/unreadable type', async () => {
    vi.mocked(getProvisionConnectorType).mockResolvedValue(null)
    renderRoute()
    await waitFor(() =>
      expect(screen.getByText(/Mit welcher Tabelle sollen wir arbeiten/i)).toBeInTheDocument(),
    )
  })
})
