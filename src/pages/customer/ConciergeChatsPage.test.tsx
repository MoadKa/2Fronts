import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ConciergeChatsPage } from './ConciergeChatsPage'
import {
  listConciergeChats,
  listConciergeConsents,
  listMyConcierges,
  getConciergeChatMessages,
  type ConciergeConsentRecord,
} from '../../services/ConciergeService'

vi.mock('../../services/ConciergeService', () => ({
  listConciergeChats: vi.fn(),
  listConciergeConsents: vi.fn(),
  listMyConcierges: vi.fn(),
  getConciergeChatMessages: vi.fn(),
}))

const chat = {
  id: 'conv-1',
  concierge_id: 'con-1',
  visitor_session_id: 'sess-abcdef123456',
  visitor_name: null,
  visitor_email: null,
  outcome: 'booking_shown' as const,
  qualified: true,
  qualification_answers: [{ criterion_id: 'budget', label: '5k+', qualifies: true }],
  created_at: '2026-06-26T10:00:00Z',
  concierge: { slug: 'coch', business_name: 'Coach Co' },
}

// The coach owns one setter; every consent test needs it, because the page reads
// the ledger per concierge (half the subject key) rather than per conversation.
const myConcierge = { id: 'con-1', slug: 'coch', business_name: 'Coach Co' }

// Two conversations, one person: the same address arriving twice, which is what
// happens when a visitor comes back on another device or after clearing storage.
const chatA = { ...chat, id: 'conv-a', visitor_session_id: 'sess-aaaaaaaa', visitor_email: 'Max@Example.com' }
const chatB = {
  ...chat,
  id: 'conv-b',
  visitor_session_id: 'sess-bbbbbbbb',
  visitor_email: 'max@example.com',
  created_at: '2026-06-27T10:00:00Z',
}

const consentRow = (over: Partial<ConciergeConsentRecord> = {}): ConciergeConsentRecord => ({
  concierge_id: 'con-1',
  visitor_email_norm: 'max@example.com',
  action: 'granted',
  created_at: '2026-06-26T10:05:00Z',
  notice_version: 'concierge-followup-email-v1',
  notice_label: 'Ja, Coach Co darf mir zu diesem Gespräch eine E-Mail schreiben.',
  notice_text: 'Wir schicken dir gleich eine kurze Bestätigungsmail.',
  rendered_business_name: 'Coach Co',
  locale: 'de',
  ...over,
})

describe('ConciergeChatsPage', () => {
  beforeEach(() => {
    vi.mocked(listMyConcierges).mockResolvedValue([])
    vi.mocked(listConciergeChats).mockResolvedValue([])
    vi.mocked(listConciergeConsents).mockResolvedValue([])
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

  // -------------------------------------------------------------------------
  // Consent
  // -------------------------------------------------------------------------

  it('gives both conversations of the same address the SAME consent badge', async () => {
    // THE BUG THIS DESIGN EXISTS TO PREVENT. Consent is keyed
    // (concierge_id, visitor_email_norm), never the conversation. If the state
    // rode on the conversation row, the session that carried the tick would show
    // one thing and the other session another, while the send path treats both
    // as the same subject. A coach reading two different answers about one person
    // is a coach who will mail the wrong one.
    vi.mocked(listMyConcierges).mockResolvedValue([myConcierge])
    vi.mocked(listConciergeChats).mockResolvedValue([chatA, chatB])
    vi.mocked(listConciergeConsents).mockResolvedValue([
      consentRow({ action: 'confirmed', created_at: '2026-06-26T10:09:00Z' }),
    ])

    render(<ConciergeChatsPage />)
    await waitFor(() => expect(screen.getByText(/sess-aaa/)).toBeInTheDocument())
    expect(screen.getByText(/sess-bbb/)).toBeInTheDocument()
    // Note chatA stores the address as typed ("Max@Example.com"): the lookup
    // normalises, exactly as the server did when it wrote visitor_email_norm.
    expect(screen.getAllByText('Bestätigt')).toHaveLength(2)
    expect(listConciergeConsents).toHaveBeenCalledWith('con-1')
  })

  it('never shows a bare grant as permission to send', async () => {
    // 'granted' means a box was ticked, nothing more: it proves someone typed
    // that address, not that they own it. The badge must read as a wait, and the
    // panel must say in words that this is not yet sendable.
    vi.mocked(listMyConcierges).mockResolvedValue([myConcierge])
    vi.mocked(listConciergeChats).mockResolvedValue([chatA])
    vi.mocked(listConciergeConsents).mockResolvedValue([consentRow()])

    render(<ConciergeChatsPage />)
    await waitFor(() => expect(screen.getByText('Wartet auf Bestätigung')).toBeInTheDocument())
    expect(screen.queryByText('Bestätigt')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /sess-aaa/ }))
    await waitFor(() =>
      expect(screen.getByText(/noch nicht versandfähig/)).toBeInTheDocument(),
    )
    expect(screen.getByText(/Schreib ihr noch nicht/)).toBeInTheDocument()
  })

  it('shows the STORED wording, including a row collected under an older version', async () => {
    // A coach challenged by a lawyer needs the text that was on screen that day.
    // Rebuilding today's wording would file a defence for a screen the visitor
    // never saw, so the panel renders what the row carries and its own version
    // label alongside it.
    vi.mocked(listMyConcierges).mockResolvedValue([myConcierge])
    vi.mocked(listConciergeChats).mockResolvedValue([chatA])
    vi.mocked(listConciergeConsents).mockResolvedValue([
      consentRow({
        action: 'confirmed',
        created_at: '2026-06-26T10:09:00Z',
        notice_version: 'concierge-followup-email-v0',
        notice_label: 'Ja, Coach Co darf mir schreiben.',
        notice_text: 'Die alte Fassung, die Max damals gelesen hat.',
      }),
    ])

    render(<ConciergeChatsPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /sess-aaa/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /sess-aaa/ }))

    await waitFor(() =>
      expect(screen.getByText('Die alte Fassung, die Max damals gelesen hat.')).toBeInTheDocument(),
    )
    expect(screen.getByText('Ja, Coach Co darf mir schreiben.')).toBeInTheDocument()
    expect(screen.getByText(/concierge-followup-email-v0/)).toBeInTheDocument()
    // The current wording must not appear anywhere: it was never on that screen.
    expect(screen.queryByText(/Wir schicken dir gleich/)).not.toBeInTheDocument()
  })

  it('shows a withdrawal that came after a confirmation as withdrawn', async () => {
    // Latest row wins. A withdrawal is a positive act the coach has to be able to
    // see they honoured, so it must never be buried under the older confirmation.
    vi.mocked(listMyConcierges).mockResolvedValue([myConcierge])
    vi.mocked(listConciergeChats).mockResolvedValue([chatA])
    vi.mocked(listConciergeConsents).mockResolvedValue([
      consentRow({ action: 'withdrawn', created_at: '2026-07-02T08:00:00Z' }),
      consentRow({ action: 'confirmed', created_at: '2026-06-26T10:09:00Z' }),
      consentRow({ action: 'granted', created_at: '2026-06-26T10:05:00Z' }),
    ])

    render(<ConciergeChatsPage />)
    await waitFor(() => expect(screen.getByText('Widerrufen')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /sess-aaa/ }))
    await waitFor(() =>
      expect(screen.getByText(/hat ihre Einwilligung widerrufen/)).toBeInTheDocument(),
    )
    // The whole ledger stays visible: three events, newest first.
    expect(screen.getAllByText(/concierge-followup-email-v1/)).toHaveLength(3)
  })

  it('says nothing is recorded when the address never consented', async () => {
    vi.mocked(listMyConcierges).mockResolvedValue([myConcierge])
    vi.mocked(listConciergeChats).mockResolvedValue([chatA])

    render(<ConciergeChatsPage />)
    await waitFor(() => expect(screen.getByText('Nichts erfasst')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /sess-aaa/ }))
    await waitFor(() =>
      expect(screen.getByText(/keine Einwilligung vor/)).toBeInTheDocument(),
    )
  })
})
