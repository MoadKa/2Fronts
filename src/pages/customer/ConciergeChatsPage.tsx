import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  listConciergeChats,
  listMyConcierges,
  getConciergeChatMessages,
  type ConciergeChatSummary,
  type ConciergeChatMessage,
  type MyConcierge,
} from '../../services/ConciergeService'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useDocumentMeta } from '../../hooks/useDocumentMeta'
import './ConciergeChatsPage.css'

type Tone = 'neutral' | 'success' | 'warning' | 'danger'

const OUTCOME_TONE: Record<ConciergeChatSummary['outcome'], Tone> = {
  open: 'neutral',
  booking_shown: 'warning',
  booking_clicked: 'success',
}

// One CSV field, quoted/escaped only when it contains a comma, quote, or newline.
function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function buildCsv(chats: ConciergeChatSummary[]): string {
  const header = ['Name', 'Email', 'Concierge', 'Qualified', 'Outcome', 'Date', 'Answers']
  const rows = chats.map((c) => [
    c.visitor_name ?? '',
    c.visitor_email ?? '',
    c.concierge?.business_name ?? '',
    c.qualified === true ? 'yes' : c.qualified === false ? 'no' : '',
    c.outcome,
    c.created_at,
    c.qualification_answers.map((a) => `${a.label}${a.qualifies ? ' (+)' : ''}`).join('; '),
  ])
  return [header, ...rows].map((r) => r.map(csvField).join(',')).join('\n')
}

// The coach's dashboard: their customer link(s), every chat on their concierge,
// and a CSV export. Reached as a per-coach link (My Requests), not a global nav
// tab — the app hosts many products, so dashboards stay contextual. Reads are
// owner-scoped by RLS.
export function ConciergeChatsPage() {
  const { t, i18n } = useTranslation()
  useDocumentMeta({ title: '2Fronts', noindex: true })
  const [concierges, setConcierges] = useState<MyConcierge[]>([])
  const [chats, setChats] = useState<ConciergeChatSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ConciergeChatSummary | null>(null)
  const [messages, setMessages] = useState<ConciergeChatMessage[] | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      listMyConcierges().catch(() => [] as MyConcierge[]),
      listConciergeChats().catch(() => [] as ConciergeChatSummary[]),
    ])
      .then(([cs, ch]) => {
        setConcierges(cs)
        setChats(ch)
      })
      .finally(() => setLoading(false))
  }, [])

  const openChat = (chat: ConciergeChatSummary) => {
    setSelected(chat)
    setMessages(null)
    getConciergeChatMessages(chat.id)
      .then(setMessages)
      .catch(() => setMessages([]))
  }

  const fmt = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(i18n.language)
  }

  const customerUrl = (slug: string) =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}/c/${slug}`

  const copyLink = (url: string, id: string) => {
    navigator.clipboard?.writeText(url)
    setCopiedId(id)
  }

  const exportCsv = () => {
    // Prepend a BOM so Excel reads UTF-8 (umlauts) correctly.
    const blob = new Blob(['﻿' + buildCsv(chats)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `concierge-chats-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="concierge-chats">
      <div className="page-header">
        <h1>{t('conciergeChats.title')}</h1>
        <p>{t('conciergeChats.subtitle')}</p>
      </div>

      {loading && (
        <div className="my-requests-loading" aria-live="polite">
          <span className="my-requests-spinner" aria-hidden="true" />
          <p>{t('conciergeChats.loading')}</p>
        </div>
      )}

      {!loading && concierges.length > 0 && (
        <div className="concierge-links rise">
          <h2>{t('conciergeChats.yourLinks')}</h2>
          <p className="concierge-links-hint">{t('conciergeChats.customerLinkHint')}</p>
          {concierges.map((c) => {
            const url = customerUrl(c.slug)
            return (
              <div key={c.id} className="concierge-link-row">
                <div className="concierge-link-info">
                  <span className="concierge-link-name">{c.business_name}</span>
                  <a className="concierge-link-url" href={url} target="_blank" rel="noopener noreferrer">
                    {url}
                  </a>
                </div>
                <button type="button" className="concierge-link-copy" onClick={() => copyLink(url, c.id)}>
                  {copiedId === c.id ? t('conciergeChats.copied') : t('conciergeChats.copyLink')}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {!loading && (
        <div className="concierge-chats-toolbar">
          <h2>{t('conciergeChats.conversations')}</h2>
          {chats.length > 0 && (
            <Button variant="secondary" onClick={exportCsv}>
              {t('conciergeChats.exportCsv')}
            </Button>
          )}
        </div>
      )}

      {!loading && chats.length === 0 && (
        <div className="empty-state rise">
          <p>{t('conciergeChats.empty')}</p>
        </div>
      )}

      {!loading && chats.length > 0 && (
        <div className="concierge-chats-list rise-stagger">
          {chats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              className="concierge-chat-card"
              onClick={() => openChat(chat)}
            >
              <div className="concierge-chat-card-main">
                <span className="concierge-chat-who">
                  {chat.visitor_name ||
                    `${t('conciergeChats.visitor')} ${chat.visitor_session_id.slice(0, 8)}`}
                </span>
                {chat.visitor_email && (
                  <span className="concierge-chat-sub">{chat.visitor_email}</span>
                )}
                {chat.concierge && (
                  <span className="concierge-chat-sub">{chat.concierge.business_name}</span>
                )}
                <span className="concierge-chat-time">{fmt(chat.created_at)}</span>
              </div>
              <div className="concierge-chat-card-tags">
                {chat.qualified === true && (
                  <Badge tone="success">{t('conciergeChats.qualified')}</Badge>
                )}
                {chat.qualified === false && (
                  <Badge tone="neutral">{t('conciergeChats.notQualified')}</Badge>
                )}
                <Badge tone={OUTCOME_TONE[chat.outcome]}>
                  {t(`conciergeChats.outcome.${chat.outcome}`)}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal isOpen={!!selected} onClose={() => setSelected(null)}>
        {selected && (
          <div className="concierge-chat-detail">
            <h2>
              {selected.visitor_name ||
                `${t('conciergeChats.visitor')} ${selected.visitor_session_id.slice(0, 8)}`}
            </h2>
            <p className="concierge-chat-detail-meta">
              {selected.visitor_email && <>{selected.visitor_email} · </>}
              {fmt(selected.created_at)}
            </p>

            {selected.qualification_answers.length > 0 && (
              <div className="concierge-chat-answers">
                <h3>{t('conciergeChats.answersTitle')}</h3>
                <ul>
                  {selected.qualification_answers.map((a, i) => (
                    <li key={i}>
                      <span>{a.label}</span>
                      <Badge tone={a.qualifies ? 'success' : 'neutral'}>
                        {a.qualifies ? t('conciergeChats.qualifies') : t('conciergeChats.notQualifies')}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="concierge-chat-transcript">
              <h3>{t('conciergeChats.transcript')}</h3>
              {messages === null && <p className="muted">{t('conciergeChats.loading')}</p>}
              {messages !== null && messages.length === 0 && (
                <p className="muted">{t('conciergeChats.noMessages')}</p>
              )}
              {messages?.map((m, i) => (
                <div key={i} className={`concierge-chat-bubble is-${m.role}`}>
                  {m.content}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
