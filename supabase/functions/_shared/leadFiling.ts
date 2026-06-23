// fileLead: the missing trigger that turns an intaked lead into a row in the
// customer's tool. Given a freshly recorded lead, it finds the connector
// provision that holds the customer's CONFIRMED config (a google_sheets column
// mapping, or a slack_notifications chosen channel) and runs that connector's
// run() to deliver the lead. The lead row is always the source of truth — if no
// confirmed connection exists yet, or filing fails, the lead simply stays put
// (never lost), and the caller decides the status.
//
// The provision resolution, the access token, and the connector run are all
// injectable so the orchestration is unit-tested offline. The default
// resolution query is exercised end-to-end against a real database.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getConnector, type ProvisionRow, type RunContext } from './connectors.ts'
import { getAccessTokenForCustomer } from './googleAuth.ts'
import { getSlackTokenForCustomer } from './slackAuth.ts'
import { type SheetsFetcher } from './sheetsClient.ts'
import { type RunResult } from './connectors.ts'

export interface LeadRow {
  id: string
  customer_id: string
  automation_id: string | null
  payload: Record<string, unknown>
  source?: string | null
}

export type FileLeadOutcome = 'filed' | 'needs_review' | 'failed' | 'skipped'

export interface FileLeadResult {
  outcome: FileLeadOutcome
  reason?: string
}

export interface LeadFilingDeps {
  // Live Google access token for the customer (google_sheets connector).
  getAccessToken: (admin: SupabaseClient, customerId: string) => Promise<string>
  // Live Slack bot token for the customer (slack_notifications connector).
  getSlackToken?: (admin: SupabaseClient, customerId: string) => Promise<string>
  sheetsFetcher?: SheetsFetcher
  slackFetcher?: (url: string, init?: RequestInit) => Promise<Response>
  // Injectable so tests drive each run() outcome without a real network call.
  runConnector?: (ctx: RunContext) => Promise<RunResult>
  // Injectable so tests don't have to model the join query.
  resolveProvision?: (
    admin: SupabaseClient,
    customerId: string,
    automationId: string | null,
  ) => Promise<ProvisionRow | null>
}

// A confirmed connection exists when the connector's config carries the field
// run() needs to deliver: google_sheets needs a columnMapping; slack_notifications
// needs a channelId. Anything else is not yet ready and we leave the lead.
function isConfirmed(row: ProvisionRow): boolean {
  const cfg = (row.config ?? {}) as { columnMapping?: unknown[]; channelId?: unknown }
  if (row.connector_type === 'slack_notifications') {
    return typeof cfg.channelId === 'string' && cfg.channelId !== ''
  }
  // Default (google_sheets): a non-empty confirmed column mapping.
  return Array.isArray(cfg.columnMapping) && cfg.columnMapping.length > 0
}

// Find a CONFIRMED connector provision for this customer (+ automation when
// known): a google_sheets mapping or a slack_notifications channel. Newest wins.
async function defaultResolveProvision(
  admin: SupabaseClient,
  customerId: string,
  automationId: string | null,
): Promise<ProvisionRow | null> {
  let query = admin
    .from('automation_provisions')
    .select('id, connector_type, config, created_at, automation_requests!inner(customer_id, automation_id)')
    .in('connector_type', ['google_sheets', 'slack_notifications'])
    .eq('automation_requests.customer_id', customerId)
  if (automationId) query = query.eq('automation_requests.automation_id', automationId)

  const { data, error } = await query
  if (error || !data) return null

  const rows = (data as (ProvisionRow & { created_at?: string })[])
    .filter(isConfirmed)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))

  return rows[0] ?? null
}

export async function fileLead(
  admin: SupabaseClient,
  lead: LeadRow,
  deps: LeadFilingDeps,
): Promise<FileLeadResult> {
  const resolve = deps.resolveProvision ?? defaultResolveProvision
  const provision = await resolve(admin, lead.customer_id, lead.automation_id)
  if (!provision) {
    return { outcome: 'skipped', reason: 'no confirmed connector connection for this customer yet' }
  }

  const connector = getConnector(provision.connector_type)
  if (!connector.run) {
    return { outcome: 'skipped', reason: `connector ${connector.connectorType} has no run()` }
  }

  // getAccessToken is the connector's one way to fetch a per-customer token; bind
  // it to the RIGHT credential for this connector type (Google access token for
  // sheets, Slack bot token for slack). Both verbs receive the same dep name so
  // the connector contract stays uniform.
  const isSlack = provision.connector_type === 'slack_notifications'
  const getAccessToken = () =>
    isSlack
      ? (deps.getSlackToken ?? getSlackTokenForCustomer)(admin, lead.customer_id)
      : deps.getAccessToken(admin, lead.customer_id)

  const run = deps.runConnector ?? ((ctx: RunContext) => connector.run!(ctx))
  const result = await run({
    row: provision,
    lead: { id: lead.id, payload: lead.payload, source: lead.source ?? null },
    deps: {
      getAccessToken,
      sheetsFetcher: deps.sheetsFetcher,
      slackFetcher: deps.slackFetcher,
    },
  })
  return { outcome: result.outcome, reason: result.reason }
}

// Default deps wiring for production callers (intake): real token refresh, real
// connectors, real Sheets/Slack fetch. The connector fetches its own token via
// getAccessToken (bound per-type above) and adds the Authorization header to each
// slackFetcher call, so the production slackFetcher is just raw fetch.
export const defaultLeadFilingDeps: LeadFilingDeps = {
  getAccessToken: (admin, customerId) => getAccessTokenForCustomer(admin, customerId),
  getSlackToken: (admin, customerId) => getSlackTokenForCustomer(admin, customerId),
  slackFetcher: (url, init) => fetch(url, init),
}
