import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SlackChannelPage } from './SlackChannelPage'
import { listSlackChannels, confirmSlackChannel } from '../../services/SlackService'

vi.mock('../../services/SlackService', () => ({
  listSlackChannels: vi.fn(),
  confirmSlackChannel: vi.fn(),
}))

const channels = [
  { id: 'C100', name: 'leads' },
  { id: 'C200', name: 'sales' },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/connect/prov-1/confirm']}>
      <Routes>
        <Route path="/connect/:provisionId/confirm" element={<SlackChannelPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SlackChannelPage', () => {
  beforeEach(() => {
    vi.mocked(listSlackChannels).mockResolvedValue(channels)
    vi.mocked(confirmSlackChannel).mockResolvedValue()
  })

  it('renders the channel list once loaded', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('#leads')).toBeInTheDocument())
    expect(screen.getByText('#sales')).toBeInTheDocument()
    expect(listSlackChannels).toHaveBeenCalledWith('prov-1')
  })

  it('keeps confirm disabled until a channel is selected', async () => {
    renderPage()
    const confirm = await screen.findByRole('button', { name: /Diesen Kanal verwenden/i })
    expect(confirm).toBeDisabled()

    fireEvent.click(screen.getByText('#sales'))
    expect(confirm).toBeEnabled()
  })

  it('confirms the chosen channel and shows the success state', async () => {
    renderPage()
    await screen.findByText('#leads')
    fireEvent.click(screen.getByText('#leads'))
    fireEvent.click(screen.getByRole('button', { name: /Diesen Kanal verwenden/i }))

    await waitFor(() => expect(confirmSlackChannel).toHaveBeenCalledTimes(1))
    expect(confirmSlackChannel).toHaveBeenCalledWith('prov-1', 'C100', 'leads')
    await waitFor(() => expect(screen.getByText(/Alles erledigt/i)).toBeInTheDocument())
    expect(screen.getByText(/#leads/)).toBeInTheDocument()
  })

  it('shows the empty state when no channels are available', async () => {
    vi.mocked(listSlackChannels).mockResolvedValue([])
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/keine Kanäle finden/i)).toBeInTheDocument(),
    )
  })

  it('shows an error state with a retry when listing fails', async () => {
    vi.mocked(listSlackChannels).mockRejectedValueOnce(
      new Error('slackConnect.errors.connection'),
    )
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/Slack-Verbindung ist abgelaufen/i)).toBeInTheDocument(),
    )

    // Retry re-calls the service; on success the list renders.
    vi.mocked(listSlackChannels).mockResolvedValue(channels)
    fireEvent.click(screen.getByRole('button', { name: /Erneut versuchen/i }))
    await waitFor(() => expect(screen.getByText('#leads')).toBeInTheDocument())
  })

  it('surfaces a confirm error and lets the user retry', async () => {
    vi.mocked(confirmSlackChannel).mockRejectedValueOnce(
      new Error('slackConnect.errors.generic'),
    )
    renderPage()
    await screen.findByText('#leads')
    fireEvent.click(screen.getByText('#leads'))
    fireEvent.click(screen.getByRole('button', { name: /Diesen Kanal verwenden/i }))

    await waitFor(() =>
      expect(screen.getByText(/konnten nicht geladen werden/i)).toBeInTheDocument(),
    )
    // Still on the picker (not success), button re-enabled.
    expect(screen.queryByText(/Alles erledigt/i)).not.toBeInTheDocument()
  })
})
