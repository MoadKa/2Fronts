import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ConciergeChatsPage } from './ConciergeChatsPage'
import {
  listConciergeChats,
  listMyConcierges,
  getConciergeChatMessages,
} from '../../services/ConciergeService'

vi.mock('../../services/ConciergeService', () => ({
  listConciergeChats: vi.fn(),
  listMyConcierges: vi.fn(),
  getConciergeChatMessages: vi.fn(),
}))

const chat = {
  id: 'conv-1',
  visitor_session_id: 'sess-abcdef123456',
  visitor_name: null,
  visitor_email: null,
  outcome: 'booking_shown' as const,
  qualified: true,
  qualification_answers: [{ criterion_id: 'budget', label: '5k+', qualifies: true }],
  created_at: '2026-06-26T10:00:00Z',
  concierge: { slug: 'coch', business_name: 'Coach Co' },
}

describe('ConciergeChatsPage', () => {
  beforeEach(() => {
    vi.mocked(listMyConcierges).mockResolvedValue([])
    vi.mocked(listConciergeChats).mockResolvedValue([])
    vi.mocked(getConciergeChatMessages).mockResolvedValue([])
  })

  it('lists conversations with the qualified + outcome badges', async () => {
    vi.mocked(listConciergeChats).mockResolvedValue([chat])
    render(<ConciergeChatsPage />)
    await waitFor(() => expect(screen.getByText(/sess-abc/)).toBeInTheDocument())
    expect(screen.getByText('Qualifiziert')).toBeInTheDocument()
    expect(screen.getByText('Termin gezeigt')).toBeInTheDocument()
  })

  it('shows the copyable customer link for each concierge', async () => {
    vi.mocked(listMyConcierges).mockResolvedValue([
      { id: 'c1', slug: 'coch', business_name: 'Coach Co' },
    ])
    render(<ConciergeChatsPage />)
    await waitFor(() => expect(screen.getByText(/\/c\/coch$/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Link kopieren' })).toBeInTheDocument()
  })

  it('shows an empty state when there are no chats', async () => {
    render(<ConciergeChatsPage />)
    await waitFor(() => expect(screen.getByText(/Noch keine Chats/)).toBeInTheDocument())
  })

  it('exports the conversations as a CSV download', async () => {
    vi.mocked(listConciergeChats).mockResolvedValue([chat])
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<ConciergeChatsPage />)
    await waitFor(() => expect(screen.getByText(/sess-abc/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Als CSV exportieren' }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
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
    expect(screen.getByText('5k+')).toBeInTheDocument()
    expect(getConciergeChatMessages).toHaveBeenCalledWith('conv-1')
  })
})
