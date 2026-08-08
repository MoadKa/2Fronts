import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  listConciergeChats,
  listConciergeConsents,
  listMyConcierges,
  getConciergeChatMessages,
  type ConciergeChatSummary,
  type ConciergeChatMessage,
  type ConciergeConsentRecord,
  type MyConcierge,
} from '../../services/ConciergeService'
import {
  effectiveConsentState,
  normalizeConsentEmail,
  type ConsentState,
} from '../../lib/consent'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { ConciergeEmbedSection } from '../../components/concierge/ConciergeEmbedSection'
import { useDocumentMeta } from '../../hooks/useDocumentMeta'
import './ConciergeChatsPage.css'

type Tone = 'neutral' | 'success' | 'warning' | 'danger'

const OUTCOME_TONE: Record<ConciergeChatSummary['outcome'], Tone> = {
  open: 'neutral',
  booking_shown: 'warning',
  booking_clicked: 'success',
}

// 'confirmed' is the ONLY green light, and the tones say so. 'granted' is a
// warning, not a success: a ticked box proves someone typed that address, not
// that they own it, and only the confirmation click ties the two together.
const CONSENT_TONE: Record<ConsentState, Tone> = {
  confirmed: 'success',
  granted: 'warning',
  withdrawn: 'danger',
  none: 'neutral',
}

// The subject of a consent is (concierge_id, visitor_email_norm) — never the
// conversation, and never the slug (an owner can rename a slug onto another
// sender's history). U+0000 separates the two halves because neither can
// contain it.
function subjectKey(conciergeId: string, email: string): string {
  return `${conciergeId}\u0000${normalizeConsentEmail(email)}`
}

// One CSV field, quoted/escaped only when it contains a comma, quote, or newline.
function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

// The export carries the consent column too. This file is the exact artefact
// somebody pastes into a mail tool, so leaving the addresses in it without the
// one fact that decides whether they may be mailed would undo the badge the
// moment the coach clicks "export".
function buildCsv(chats: ConciergeChatSummary[], consentLabel: (c: ConciergeChatSummary) => string): string {
  const header = ['Name', 'Email', 'Concierge', 'Qualified', 'Outcome', 'Date', 'Consent', 'Answers']
  const rows = chats.map((c) => [
    c.visitor_name ?? '',
    c.visitor_email ?? '',
    c.concierge?.business_name ?? '',
    c.qualified === true ? 'yes' : c.qualified === false ? 'no' : '',
    c.outcome,
    c.created_at,
    consentLabel(c),
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
  const [consents, setConsents] = useState<ConciergeConsentRecord[]>([])
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
        // The ledger is read per concierge, because that is half the subject key.
        // A failure degrades to "nothing recorded", which is the safe direction:
        // it can only ever withhold a green light, never invent one.
        return Promise.all(
          cs.map((c) => listConciergeConsents(c.id).catch(() => [] as ConciergeConsentRecord[])),
        )
      })
      .then((lists) => setConsents(lists.flat()))
      .catch(() => setConsents([]))
      .finally(() => setLoading(false))
  }, [])

  // Consent lives on an ADDRESS, not on a conversation. Two sessions from the
  // same person are one subject: whatever the ledger says applies to both cards,
  // because it is what the send path will apply to both.
  const consentBySubject = useMemo(() => {
    const ledger = new Map<string, ConciergeConsentRecord[]>()
    for (const r of consents) {
      const key = subjectKey(r.concierge_id, r.visitor_email_norm)
      const rows = ledger.get(key)
      if (rows) rows.push(r)
      else ledger.set(key, [r])
    }
    const states = new Map<string, ConsentState>()
    for (const [key, rows] of ledger) states.set(key, effectiveConsentState(rows))
    return states
  }, [consents])

  const consentRecordsFor = (chat: ConciergeChatSummary): ConciergeConsentRecord[] => {
    if (!chat.visitor_email) return []
    const key = subjectKey(chat.concierge_id, chat.visitor_email)
    return consents.filter((r) => subjectKey(r.concierge_id, r.visitor_email_norm) === key)
  }

  const consentStateFor = (chat: ConciergeChatSummary): ConsentState => {
    if (!chat.visitor_email) return 'none'
    return consentBySubject.get(subjectKey(chat.concierge_id, chat.visitor_email)) ?? 'none'
  }

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
    const csv = buildCsv(chats, (c) =>
      t(`conciergeChats.consent.state.${consentStateFor(c)}`),
    )
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
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

      {/* Self-serve install: the widget snippet(s) + tutorial for putting the
          setter on the coach's own website as a chat bubble. */}
      {!loading && concierges.length > 0 && (
        <ConciergeEmbedSection slugs={concierges.map((c) => c.slug)} />
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
                {/* Only where there is an address to mail. A chat without one
                    has no consent subject, so a badge there would answer a
                    question nobody asked. */}
                {chat.visitor_email && (
                  <Badge tone={CONSENT_TONE[consentStateFor(chat)]}>
                    {t(`conciergeChats.consent.state.${consentStateFor(chat)}`)}
                  </Badge>
                )}
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

      <Modal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        label={
          selected
            ? selected.visitor_name ||
              `${t('conciergeChats.visitor')} ${selected.visitor_session_id.slice(0, 8)}`
            : undefined
        }
      >
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

            {/* The consent panel. It shows the STORED wording, row by row, and
                never rebuilds today's text: a coach challenged over a mail has
                to produce what stood on the visitor's screen that day, which for
                an older row is older wording. */}
            {selected.visitor_email && (
              <div className="concierge-chat-consent">
                <h3>{t('conciergeChats.consent.title')}</h3>
                <p className="concierge-chat-consent-state">
                  <Badge tone={CONSENT_TONE[consentStateFor(selected)]}>
                    {t(`conciergeChats.consent.state.${consentStateFor(selected)}`)}
                  </Badge>
                  <span>{t(`conciergeChats.consent.explain.${consentStateFor(selected)}`)}</span>
                </p>

                {consentRecordsFor(selected).length === 0 && (
                  <p className="muted">{t('conciergeChats.consent.noRecords')}</p>
                )}

                {consentRecordsFor(selected).length > 0 && (
                  <>
                    <h4>{t('conciergeChats.consent.evidenceTitle')}</h4>
                    <p className="muted">{t('conciergeChats.consent.evidenceHint')}</p>
                    <ul className="concierge-chat-consent-records">
                      {consentRecordsFor(selected).map((r, i) => (
                        <li key={i}>
                          <span className="concierge-chat-consent-head">
                            {t(`conciergeChats.consent.action.${r.action}`)} · {fmt(r.created_at)} ·{' '}
                            {t('conciergeChats.consent.version')}: {r.notice_version} ·{' '}
                            {t('conciergeChats.consent.sender')}: {r.rendered_business_name}
                          </span>
                          {r.notice_label && (
                            <p className="concierge-chat-consent-label">{r.notice_label}</p>
                          )}
                          {r.notice_text && (
                            <p className="concierge-chat-consent-text">{r.notice_text}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

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
