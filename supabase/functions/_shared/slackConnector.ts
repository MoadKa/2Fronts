// The Slack lead-notification connector. Mirrors the google_sheets connector
// shape (see connectors.ts) so adding Slack is adding a connector, not editing
// the orchestrator:
//   provision  -- no external resource to claim at paid->active; succeeds.
//   configure  -- list the workspace's channels (conversations.list) so the
//                 customer can pick one. Proposal only; a human confirms.
//   run        -- post one lead to the confirmed channel via chat.postMessage.
//
// OAuth v2 (scopes chat:write + channels:read) stores a bot token per customer
// in connector_connections, exactly like Google's refresh token. configure/run
// reach Slack with that token, supplied by the OAuth lane via getAccessToken.
//
// Every external effect (the Slack Web API fetch, the access token) is injected
// so all three verbs unit-test offline against fakes — matching the Google
// Sheets connector test style.

import type {
  ConfigureContext,
  ConfigureResult,
  Connector,
  ProvisionRow,
  RunContext,
  RunResult,
} from './connectors.ts'

export const SLACK_CONNECTOR_TYPE = 'slack_notifications'

// OAuth v2 bot scopes: post messages + list public channels to choose from.
export const SLACK_OAUTH_SCOPES = ['chat:write', 'channels:read']

const SLACK_API_BASE = 'https://slack.com/api'

// Injectable Slack Web API fetch (mirrors SheetsFetcher). Defaults to real fetch
// when omitted, but tests always inject a fake so no network is touched.
export type SlackFetcher = (url: string, init?: RequestInit) => Promise<Response>

// The confirmed config a slack_notifications provision carries once the customer
// has picked a channel. channelId is what run() posts to; channelName is kept
// for display only.
interface SlackConfig {
  channelId?: string
  channelName?: string
}

function readSlackConfig(row: ProvisionRow): SlackConfig {
  return (row.config ?? {}) as SlackConfig
}

export interface SlackChannel {
  id: string
  name: string
}

interface SlackConversationsListResponse {
  ok?: boolean
  error?: string
  channels?: { id?: string; name?: string }[]
  response_metadata?: { next_cursor?: string }
}

interface SlackPostMessageResponse {
  ok?: boolean
  error?: string
  ts?: string
}

// List the workspace's public channels the bot can see. Paginates through
// response_metadata.next_cursor so a workspace with many channels still returns
// them all. Throws on a Slack-level error (ok:false) so the caller surfaces it.
export async function listChannels(
  accessToken: string,
  fetcher: SlackFetcher,
): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = []
  let cursor: string | undefined
  do {
    const params = new URLSearchParams({
      types: 'public_channel',
      exclude_archived: 'true',
      limit: '200',
    })
    if (cursor) params.set('cursor', cursor)

    const res = await fetcher(`${SLACK_API_BASE}/conversations.list?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = (await res.json().catch(() => ({}))) as SlackConversationsListResponse
    if (!res.ok || !data.ok) {
      throw new Error(`slack_conversations_list_failed: ${data.error ?? res.status}`)
    }
    for (const c of data.channels ?? []) {
      if (c.id && c.name) channels.push({ id: c.id, name: c.name })
    }
    cursor = data.response_metadata?.next_cursor || undefined
  } while (cursor)

  return channels
}

// Render a lead into a readable Slack message. Keeps it to a basic lead card
// (out of scope: templating). Known canonical fields lead; any extra payload
// keys follow so nothing captured is silently dropped.
const LEAD_FIELD_ORDER = ['Name', 'Telefon', 'E-Mail', 'Quelle', 'Datum']

export function formatLeadMessage(
  payload: Record<string, unknown>,
  source?: string | null,
): string {
  const lines: string[] = ['*Neuer Lead*']

  const seen = new Set<string>()
  for (const field of LEAD_FIELD_ORDER) {
    const v = payload[field]
    if (v !== null && v !== undefined && v !== '') {
      lines.push(`*${field}:* ${typeof v === 'string' ? v : String(v)}`)
    }
    seen.add(field)
  }
  for (const [k, v] of Object.entries(payload)) {
    if (seen.has(k)) continue
    if (v !== null && v !== undefined && v !== '') {
      lines.push(`*${k}:* ${typeof v === 'string' ? v : String(v)}`)
    }
  }

  if (source) lines.push(`_Quelle: ${source}_`)
  return lines.join('\n')
}

export const slackConnector: Connector = {
  connectorType: SLACK_CONNECTOR_TYPE,

  // No external resource to claim at paid->active for a Slack connection; the
  // provision simply succeeds. (Idempotent: calling again is harmless.)
  provision() {
    return Promise.resolve('active')
  },

  // First-connect: list the workspace channels so the customer can pick one.
  // We surface them as the "proposed mapping" (one entry per channel) to reuse
  // the connector contract; the confirm step writes the chosen channel to config.
  async configure({ row, deps }: ConfigureContext): Promise<ConfigureResult> {
    if (!deps.getAccessToken) {
      throw new Error('slack_notifications connector requires the getAccessToken dependency')
    }
    if (!deps.slackFetcher) {
      throw new Error('slack_notifications connector requires the slackFetcher dependency')
    }

    const accessToken = await deps.getAccessToken({ customerId: null, row })
    const channels = await listChannels(accessToken, deps.slackFetcher)

    // Map channels onto ConfigureResult: headers = channel names, and the
    // proposed "mapping" carries each channel's id (column) under its name
    // (field). The connect-configure handler reshapes this into a channel
    // picker; run() only reads config.channelId, set at confirm time.
    return {
      headers: channels.map((c) => c.name),
      sampleRow: channels.map((c) => c.id),
      proposedMapping: channels.map((c) => ({
        field: c.name,
        column: c.id,
        confidence: 'high' as const,
      })),
    }
  },

  // File one lead by posting it to the confirmed channel. No confirmed channel
  // -> needs_review (nothing safe to post). A Slack-level error -> failed.
  async run({ row, lead, deps }: RunContext): Promise<RunResult> {
    if (!deps.getAccessToken) {
      throw new Error('slack_notifications connector requires the getAccessToken dependency')
    }
    if (!deps.slackFetcher) {
      throw new Error('slack_notifications connector requires the slackFetcher dependency')
    }

    const { channelId } = readSlackConfig(row)
    if (!channelId) {
      return { outcome: 'needs_review', reason: 'No Slack channel chosen for this connection yet' }
    }

    try {
      const accessToken = await deps.getAccessToken({ customerId: null, row })
      const res = await deps.slackFetcher(`${SLACK_API_BASE}/chat.postMessage`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          channel: channelId,
          text: formatLeadMessage(lead.payload, lead.source),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as SlackPostMessageResponse
      if (!res.ok || !data.ok) {
        return { outcome: 'failed', reason: `chat.postMessage failed: ${data.error ?? res.status}` }
      }
      return { outcome: 'filed' }
    } catch (e) {
      return { outcome: 'failed', reason: e instanceof Error ? e.message : 'chat.postMessage failed' }
    }
  },
}
