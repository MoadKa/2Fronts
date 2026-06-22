// fileLead: the missing trigger that turns an intaked lead into a row in the
// customer's sheet. Given a freshly recorded lead, it finds the google_sheets
// provision that holds the customer's CONFIRMED column mapping and runs the
// connector's run() to append the lead. The lead row is always the source of
// truth — if no mapping exists yet, or filing fails, the lead simply stays put
// (never lost), and the caller decides the status.
//
// The provision resolution, the access token, and the connector run are all
// injectable so the orchestration is unit-tested offline. The default
// resolution query is exercised end-to-end against a real database.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { googleSheetsConnector, type ProvisionRow } from './connectors.ts'
import { getAccessTokenForCustomer } from './googleAuth.ts'
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
  getAccessToken: (admin: SupabaseClient, customerId: string) => Promise<string>
  sheetsFetcher?: SheetsFetcher
  // Injectable so tests drive each run() outcome without a real Sheets call.
  runConnector?: (ctx: Parameters<NonNullable<typeof googleSheetsConnector.run>>[0]) => Promise<RunResult>
  // Injectable so tests don't have to model the join query.
  resolveProvision?: (
    admin: SupabaseClient,
    customerId: string,
    automationId: string | null,
  ) => Promise<ProvisionRow | null>
}

// Find the google_sheets provision for this customer (+ automation when known)
// that already carries a confirmed columnMapping. Newest wins.
async function defaultResolveProvision(
  admin: SupabaseClient,
  customerId: string,
  automationId: string | null,
): Promise<ProvisionRow | null> {
  let query = admin
    .from('automation_provisions')
    .select('id, connector_type, config, created_at, automation_requests!inner(customer_id, automation_id)')
    .eq('connector_type', 'google_sheets')
    .eq('automation_requests.customer_id', customerId)
  if (automationId) query = query.eq('automation_requests.automation_id', automationId)

  const { data, error } = await query
  if (error || !data) return null

  const rows = (data as (ProvisionRow & { created_at?: string })[])
    .filter((r) => {
      const cfg = (r.config ?? {}) as { columnMapping?: unknown[] }
      return Array.isArray(cfg.columnMapping) && cfg.columnMapping.length > 0
    })
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
    return { outcome: 'skipped', reason: 'no confirmed google_sheets mapping for this customer yet' }
  }

  const run = deps.runConnector ?? ((ctx) => googleSheetsConnector.run!(ctx))
  const result = await run({
    row: provision,
    lead: { id: lead.id, payload: lead.payload, source: lead.source ?? null },
    deps: {
      getAccessToken: () => deps.getAccessToken(admin, lead.customer_id),
      sheetsFetcher: deps.sheetsFetcher,
    },
  })
  return { outcome: result.outcome, reason: result.reason }
}

// Default deps wiring for production callers (intake): real token refresh, real
// connector, real Sheets fetch.
export const defaultLeadFilingDeps: LeadFilingDeps = {
  getAccessToken: (admin, customerId) => getAccessTokenForCustomer(admin, customerId),
}
