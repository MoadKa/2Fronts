import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ConciergeChatsPage } from './ConciergeChatsPage'
import { listConciergeChats, getConciergeChatMessages } from '../../services/ConciergeService'

vi.mock('../../services/ConciergeService', () => ({
  listConciergeChats: vi.fn(),
  getConciergeChatMessages: vi.fn(),
}))

const chat = {
  id: 'conv-1',
  visitor_session_id: 'sess-abcdef123456',
  outcome: 'booking_shown' as const,
  qualified: true,
  qualification_answers: [{ criterion_id: 'budget', label: '5k+', qualifies: true }],
  created_at: '2026-06-26T10:00:00Z',
  concierge: { slug: 'coch', business_name: 'Coach Co' },
}

describe('ConciergeChatsPage', () => {
  it('lists conversations with the qualified + outcome badges', async () => {
    vi.mocked(listConciergeChats).mockResolvedValue([chat])
    render(<ConciergeChatsPage />)
    await waitFor(() => expect(screen.getByText(/sess-abc/)).toBeInTheDocument())
    expect(screen.getByText('Qualifiziert')).toBeInTheDocument()
    expect(screen.getByText('Termin gezeigt')).toBeInTheDocument()
  })

  it('shows an empty state when there are no chats', async () => {
    vi.mocked(listConciergeChats).mockResolvedValue([])
    render(<ConciergeChatsPage />)
    await waitFor(() => expect(screen.getByText(/Noch keine Chats/)).toBeInTheDocument())
  })

  it('opens the transcript with the messages and qualification answers on click', async () => {
    vi.mocked(listConciergeChats).mockResolvedValue([chat])
    vi.mocked(getConciergeChatMessages).mockResolvedValue([
      { role: 'user', content: 'Hallo, ich suche Hilfe', created_at: '2026-06-26T10:01:00Z' },
      { role: 'assistant', content: 'Gerne! Worum geht es?', created_at: '2026-06-26T10:01:05Z' },
    ])
    render(<ConciergeChatsPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /sess-abc/ })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /sess-abc/ }))

    await waitFor(() => expect(screen.getByText('Hallo, ich suche Hilfe')).toBeInTheDocument())
    expect(screen.getByText('Gerne! Worum geht es?')).toBeInTheDocument()
    // The qualification answer is shown in the detail panel.
    expect(screen.getByText('5k+')).toBeInTheDocument()
    expect(getConciergeChatMessages).toHaveBeenCalledWith('conv-1')
  })
})
