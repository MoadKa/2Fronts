import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { attemptProvision, type AttemptProvisionResult, type ProvisionAutomation } from './provisioning.ts'
import { appendRow, readHeaderRow, type SheetsFetcher } from './sheetsClient.ts'
import {
  type ColumnMappingDeps,
  type ColumnMappingEntry,
  DEFAULT_LEAD_FIELDS,
  proposeColumnMapping,
} from './columnMapping.ts'
import { slackConnector, type SlackFetcher } from './slackConnector.ts'

// A connector is the unit of "reach into one tool and make the automation
// real". The whole pipeline is generic over this interface; adding a tool is
// adding a connector, not editing the orchestrator (make-the-change-easy).
//
// v1 exercises provision -- the paid -> active step. connect/configure/run/
// deprovision are part of the contract and fill in as connectors need them:
//   google_sheets adds configure + run   (T4)
//   OAuth connectors add connect/deprovision (T3)
// They are optional so a connector implements only the verbs it supports.

// The provision row as connectors receive it. connector_type selects the
// connector; the Twilio columns remain for the missed-call connector; config
// carries connector-specific settings (e.g. spreadsheet id + confirmed map).
export interface ProvisionRow {
  id: string
  connector_type?: string | null
  business_name?: string | null
  booking_link?: string | null
  config?: Record<string, unknown> | null
  status?: string
}

// Dependencies the orchestrator injects. Kept connector-agnostic: each
// connector reads what it needs. provisionAutomation is the Twilio number
// purchaser; the google_sheets connector reads getAccessToken (per-customer
// OAuth token, supplied by the OAuth lane) + sheetsFetcher/complete (injectable
// for tests). All optional so a connector only requires what it uses.
export interface ConnectorDeps {
  provisionAutomation?: ProvisionAutomation
  // Resolve a usable Google access token for the customer who owns this
  // provision. OAuth storage/refresh lives in another lane (T3); we just ask.
  getAccessToken?: (ctx: { customerId?: string | null; row: ProvisionRow }) => Promise<string>
  // Injectable Sheets fetch + LLM call so configure/run run with no network in
  // tests. Both default to the real implementations when omitted.
  sheetsFetcher?: SheetsFetcher
  complete?: ColumnMappingDeps['complete']
  // Injectable Slack Web API fetch for the slack_notifications connector, so its
  // configure/run run with no network in tests (mirrors sheetsFetcher).
  slackFetcher?: SlackFetcher
}

export interface ProvisionContext {
  adminClient: SupabaseClient
  row: ProvisionRow
  fromStatus: string
  deps: ConnectorDeps
}

// configure() is the first-connect step: read the customer's sheet header row
// (+ a sample lead) and propose a column mapping with per-field confidence. It
// proposes; a human confirms; the confirmed map is stored in provision config.
export interface ConfigureContext {
  row: ProvisionRow
  deps: ConnectorDeps
}

export interface ConfigureResult {
  // The detected sheet headers, the sample row we reasoned over, and the
  // proposed (NOT yet confirmed) mapping for a human to approve.
  headers: string[]
  sampleRow: string[]
  proposedMapping: ColumnMappingEntry[]
}

// run() files one lead. It reads the CONFIRMED mapping from provision config
// and appends a row. The outcome decides the lead's status: a complete mapping
// -> 'filed'; a missing/incomplete mapping -> 'needs_review' (never a guess).
export interface RunContext {
  row: ProvisionRow
  // The lead to file: its raw payload, keyed by canonical field where known.
  lead: { id: string; payload: Record<string, unknown>; source?: string | null }
  deps: ConnectorDeps
}

export type RunOutcome = 'filed' | 'needs_review' | 'failed'

export interface RunResult {
  outcome: RunOutcome
  // Why we held back, when we did -- surfaced to the human reviewing the lead.
  reason?: string
}

export interface Connector {
  connectorType: string
  provision(ctx: ProvisionContext): Promise<AttemptProvisionResult>
  // First-connect mapping proposal + per-lead filing. Optional so a connector
  // implements only the verbs it supports (twilio has neither).
  configure?(ctx: ConfigureContext): Promise<ConfigureResult>
  run?(ctx: RunContext): Promise<RunResult>
  // connect?, deprovision? -- added by later tasks (OAuth lane).
}

// The missed-call connector. Its one-time provision = buy the Twilio number,
// which the existing claim-first attemptProvision engine already does
// idempotently. Reusing it keeps the proven Twilio path byte-for-byte.
export const twilioMissedCallConnector: Connector = {
  connectorType: 'twilio_missed_call',
  // async so a missing-dep guard surfaces as a rejected promise, not a
  // synchronous throw -- callers handle every failure mode the same way.
  async provision({ adminClient, row, fromStatus, deps }) {
    if (!deps.provisionAutomation) {
      throw new Error('twilio_missed_call connector requires the provisionAutomation dependency')
    }
    return await attemptProvision(
      adminClient,
      row as { id: string; business_name: string },
      fromStatus,
      deps.provisionAutomation,
    )
  },
}

// The shape of the confirmed config a google_sheets provision carries once a
// human has approved the proposed mapping. spreadsheetId is the target sheet;
// columnMapping is the human-confirmed field -> column map run() files against.
interface GoogleSheetsConfig {
  spreadsheetId?: string
  // The CONFIRMED mapping (post-human-approval). A field whose column is null
  // is intentionally unmapped; we never write a value for it.
  columnMapping?: ColumnMappingEntry[]
}

function readSheetsConfig(row: ProvisionRow): GoogleSheetsConfig {
  return (row.config ?? {}) as GoogleSheetsConfig
}

// Stringify one lead value for a cell. Sheets RAW write wants strings; nullish
// values become '' so the row stays column-aligned.
function cellValue(payload: Record<string, unknown>, field: string): string {
  const v = payload[field]
  if (v === null || v === undefined) return ''
  return typeof v === 'string' ? v : String(v)
}

// The Google Sheets connector. provision is a no-op success here -- there is no
// number to buy; the real work is configure (propose mapping at first connect)
// and run (file each lead, append-only). Reaching the customer's sheet needs a
// per-customer access token from the OAuth lane, requested via getAccessToken.
export const googleSheetsConnector: Connector = {
  connectorType: 'google_sheets',

  // No external resource to claim at paid->active for a sheet connection; the
  // provision simply succeeds. (Idempotent: calling again is harmless.)
  provision() {
    return Promise.resolve('active')
  },

  // First-connect: read the header row (+ a sample lead) and propose a mapping.
  // Proposal only -- a human confirms before any lead is written.
  async configure({ row, deps }) {
    if (!deps.getAccessToken) {
      throw new Error('google_sheets connector requires the getAccessToken dependency')
    }
    const { spreadsheetId } = readSheetsConfig(row)
    if (!spreadsheetId) {
      throw new Error('google_sheets configure requires config.spreadsheetId')
    }
    if (!deps.complete) {
      throw new Error('google_sheets configure requires the complete dependency')
    }

    const accessToken = await deps.getAccessToken({ customerId: null, row })
    const { headers, sampleRow } = await readHeaderRow(spreadsheetId, accessToken, deps.sheetsFetcher)

    // Pair the sample row's values with their headers so the mapper sees real
    // example data ("Telefoon" -> "+31...") not just bare header strings.
    const sampleLead: Record<string, string> = {}
    headers.forEach((h, i) => {
      if (sampleRow[i] !== undefined) sampleLead[h] = sampleRow[i]
    })

    const proposedMapping = await proposeColumnMapping(
      { headers, sampleLead, fields: DEFAULT_LEAD_FIELDS },
      { complete: deps.complete },
    )

    return { headers, sampleRow, proposedMapping }
  },

  // File one lead. The CONFIRMED mapping in config decides everything:
  //   - no spreadsheet / no mapping -> needs_review (nothing safe to write)
  //   - any mapped field whose value is missing from the payload -> needs_review
  //   - otherwise append-only write, lead -> filed
  // We never write a partial/guessed row: F3's "an unmapped field is better
  // than a wrong one" extends to "a half-known lead waits for a human".
  async run({ row, lead, deps }) {
    if (!deps.getAccessToken) {
      throw new Error('google_sheets connector requires the getAccessToken dependency')
    }
    const { spreadsheetId, columnMapping } = readSheetsConfig(row)

    if (!spreadsheetId || !columnMapping || columnMapping.length === 0) {
      return { outcome: 'needs_review', reason: 'No confirmed column mapping for this sheet yet' }
    }

    // The mapped fields are the ones we intend to write. An unmapped (null)
    // field is fine -- we just leave its cell empty. But if a field is mapped
    // to a real column and the lead has no value for it, we hold for review
    // rather than file an incomplete row.
    const mapped = columnMapping.filter((m) => m.column !== null)
    if (mapped.length === 0) {
      return { outcome: 'needs_review', reason: 'Confirmed mapping has no usable columns' }
    }

    const missing = mapped
      .map((m) => m.field)
      .filter((field) => {
        const v = lead.payload[field]
        return v === null || v === undefined || v === ''
      })
    if (missing.length > 0) {
      return {
        outcome: 'needs_review',
        reason: `Lead is missing values for mapped fields: ${missing.join(', ')}`,
      }
    }

    try {
      const accessToken = await deps.getAccessToken({ customerId: null, row })

      // values:append starts writing at column A, so the row must be aligned to
      // the sheet's actual column order. Re-read the live header row to place
      // each mapped value under its column; unmapped columns stay empty. Reading
      // headers at file-time also catches a sheet whose columns moved since the
      // mapping was confirmed (a missing column -> safe needs_review, not a
      // misplaced write).
      const { headers } = await readHeaderRow(spreadsheetId, accessToken, deps.sheetsFetcher)
      if (headers.length === 0) {
        return { outcome: 'needs_review', reason: 'Sheet has no header row to align against' }
      }

      const columnIndex = (col: string) => headers.indexOf(col)
      const driftedColumns = mapped.map((m) => m.column!).filter((col) => columnIndex(col) === -1)
      if (driftedColumns.length > 0) {
        return {
          outcome: 'needs_review',
          reason: `Mapped columns no longer in the sheet: ${driftedColumns.join(', ')}`,
        }
      }

      // Build a full-width, header-aligned row: empty everywhere except the
      // mapped columns, which carry this lead's values.
      const values: string[] = headers.map(() => '')
      for (const m of mapped) {
        values[columnIndex(m.column!)] = cellValue(lead.payload, m.field)
      }

      await appendRow(spreadsheetId, values, accessToken, deps.sheetsFetcher)
      return { outcome: 'filed' }
    } catch (e) {
      return { outcome: 'failed', reason: e instanceof Error ? e.message : 'append failed' }
    }
  },
}

// The AI Booking Concierge connector (#24). There is nothing external to claim
// at paid->active: the concierge itself is created during setup (the coach fills
// the form, which inserts the concierges row and links it via config.concierge_id).
// So provision is a no-op success, exactly like google_sheets — fulfillment just
// advances the provision to 'active' and the setup screen does the real work.
export const bookingConciergeConnector: Connector = {
  connectorType: 'booking_concierge',
  provision() {
    return Promise.resolve('active')
  },
}

const defaultRegistry: Record<string, Connector> = {
  [twilioMissedCallConnector.connectorType]: twilioMissedCallConnector,
  [googleSheetsConnector.connectorType]: googleSheetsConnector,
  [slackConnector.connectorType]: slackConnector,
  [bookingConciergeConnector.connectorType]: bookingConciergeConnector,
}

// Dispatch by connector_type. A null/undefined type (legacy rows written before
// the column existed, and pre-pipeline tests) defaults to the missed-call
// connector, matching the automation_provisions.connector_type column default.
export function getConnector(
  connectorType: string | undefined | null,
  registry: Record<string, Connector> = defaultRegistry,
): Connector {
  const type = connectorType ?? twilioMissedCallConnector.connectorType
  const connector = registry[type]
  if (!connector) {
    throw new Error(`No connector registered for type: ${type}`)
  }
  return connector
}
