import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  listConciergeChats,
  getConciergeChatMessages,
  type ConciergeChatSummary,
  type ConciergeChatMessage,
} from '../../services/ConciergeService'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import './ConciergeChatsPage.css'

type Tone = 'neutral' | 'success' | 'warning' | 'danger'

const OUTCOME_TONE: Record<ConciergeChatSummary['outcome'], Tone> = {
  open: 'neutral',
  booking_shown: 'warning',
  booking_clicked: 'success',
}

// The coach's dashboard: every chat happening on their concierge link, with the
// qualification outcome and a click-through to the full transcript. Reads are
// owner-scoped by RLS (owners-read policy added in the migration).
export function ConciergeChatsPage() {
  const { t, i18n } = useTranslation()
  const [chats, setChats] = useState<ConciergeChatSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ConciergeChatSummary | null>(null)
  const [messages, setMessages] = useState<ConciergeChatMessage[] | null>(null)

  useEffect(() => {
    listConciergeChats()
      .then((d) => setChats(d))
      .catch(() => setChats([]))
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
                  {t('conciergeChats.visitor')} {chat.visitor_session_id.slice(0, 8)}
                </span>
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
              {t('conciergeChats.visitor')} {selected.visitor_session_id.slice(0, 8)}
            </h2>
            <p className="concierge-chat-detail-meta">{fmt(selected.created_at)}</p>

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
