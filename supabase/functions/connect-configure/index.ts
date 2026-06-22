// connect-configure: the step that turns "I connected Google" into "here is the
// column mapping to confirm". The customer pastes their Google Sheet link; we
//   1. verify they own the provision (JWT uid == provision's customer),
//   2. pull a live access token from their stored connection,
//   3. read the sheet's header row + a sample lead and ask the AI mapper to
//      propose a field->column mapping (configure()),
//   4. write config.spreadsheetId + config.proposedMapping back onto the
//      provision and return the proposal for the confirm screen.
//
// All external effects (admin client, user lookup, access token, the LLM
// completion, the Sheets fetch) are injected so tests run offline.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { getAccessTokenForCustomer } from '../_shared/googleAuth.ts'
import { googleSheetsConnector } from '../_shared/connectors.ts'
import { type ColumnMappingEntry, createGeminiComplete, type CompleteFn } from '../_shared/columnMapping.ts'
import { type SheetsFetcher } from '../_shared/sheetsClient.ts'

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// --- The shape the confirm screen reads (mirror of src/types/database.ts) ----
interface ProposedFieldMapping {
  field: string
  label: string
  column: string | null
  columnLabel: string | null
  confidence: 'high' | 'low'
}
interface ProposedMapping {
  connectorType: string
  sheetTitle: string
  fields: ProposedFieldMapping[]
  sampleLead: Record<string, string>
  availableColumns: { value: string; label: string }[]
}

// Accept a full Google Sheets URL or a bare spreadsheet id.
export function extractSpreadsheetId(input: string): string | null {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (m) return m[1]
  const trimmed = input.trim()
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed
  return null
}

// Transform the connector's raw configure() output into the ProposedMapping the
// frontend renders. The column VALUE must be the live header string, because
// that is exactly what run() matches against when it aligns a lead to columns.
export function toProposedMapping(opts: {
  headers: string[]
  sampleRow: string[]
  entries: ColumnMappingEntry[]
  sheetTitle: string
}): ProposedMapping {
  const availableColumns = opts.headers
    .filter((h) => h && h.trim() !== '')
    .map((h) => ({ value: h, label: h }))

  const sampleLead: Record<string, string> = {}
  opts.headers.forEach((h, i) => {
    const v = opts.sampleRow[i]
    if (h && v !== undefined && v !== '') sampleLead[h] = v
  })

  const fields: ProposedFieldMapping[] = opts.entries.map((e) => ({
    field: e.field,
    label: e.field, // canonical fields (Name/Telefon/...) are already human labels
    column: e.column,
    columnLabel: e.column,
    confidence: e.confidence,
  }))

  return { connectorType: 'google_sheets', sheetTitle: opts.sheetTitle, fields, sampleLead, availableColumns }
}

export interface ConfigureDeps {
  createAdminClient: () => SupabaseClient
  // Resolve the caller's user id from their JWT (Authorization header).
  getUserId: (authHeader: string) => Promise<string | null>
  // Live Google access token for a customer (wraps the refresh helper).
  getAccessToken: (admin: SupabaseClient, customerId: string) => Promise<string>
  // The AI completion (defaults to Gemini); injected so tests are offline.
  complete?: CompleteFn
  sheetsFetcher: SheetsFetcher
}

async function defaultGetUserId(authHeader: string): Promise<string | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon || !authHeader) return null
  const client = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const { data } = await client.auth.getUser()
  return data.user?.id ?? null
}

const defaultDeps: ConfigureDeps = {
  createAdminClient,
  getUserId: defaultGetUserId,
  getAccessToken: (admin, customerId) => getAccessTokenForCustomer(admin, customerId),
  // Lazy so a missing GEMINI_API_KEY only errors when actually mapping, not at import.
  complete: (prompt) => createGeminiComplete(Deno.env.get('GEMINI_API_KEY'), (u, i) => fetch(u, i))(prompt),
  sheetsFetcher: (url, init) => fetch(url, init),
}

async function fetchSheetTitle(
  spreadsheetId: string,
  accessToken: string,
  fetcher: SheetsFetcher,
): Promise<string> {
  try {
    const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=properties.title`
    const res = await fetcher(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) return 'Ihre Tabelle'
    const data = (await res.json()) as { properties?: { title?: string } }
    return data.properties?.title ?? 'Ihre Tabelle'
  } catch {
    return 'Ihre Tabelle'
  }
}

export async function handleConfigure(req: Request, deps: ConfigureDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders })
  }

  let body: { provisionId?: unknown; spreadsheetUrl?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders })
  }

  const provisionId = typeof body.provisionId === 'string' ? body.provisionId : ''
  const spreadsheetUrl = typeof body.spreadsheetUrl === 'string' ? body.spreadsheetUrl : ''
  if (!provisionId) {
    return new Response(JSON.stringify({ error: 'provisionId is required' }), { status: 400, headers: jsonHeaders })
  }

  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl)
  if (!spreadsheetId) {
    return new Response(JSON.stringify({ error: 'invalid_sheet_url' }), { status: 400, headers: jsonHeaders })
  }

  // Authz: the caller must be the customer who owns this provision.
  const uid = await deps.getUserId(req.headers.get('Authorization') ?? '')
  if (!uid) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  const admin = deps.createAdminClient()
  const { data: provData, error: provErr } = await admin
    .from('automation_provisions')
    .select('config, automation_requests(customer_id)')
    .eq('id', provisionId)
    .maybeSingle()

  if (provErr || !provData) {
    return new Response(JSON.stringify({ error: 'provision_not_found' }), { status: 404, headers: jsonHeaders })
  }
  const rel = (provData as { automation_requests?: unknown }).automation_requests
  const reqRow = (Array.isArray(rel) ? rel[0] : rel) as { customer_id?: string } | undefined
  const customerId = reqRow?.customer_id
  if (!customerId) {
    return new Response(JSON.stringify({ error: 'provision_not_found' }), { status: 404, headers: jsonHeaders })
  }
  if (customerId !== uid) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: jsonHeaders })
  }

  const existingConfig = ((provData as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>

  try {
    const accessToken = await deps.getAccessToken(admin, customerId)
    const complete = deps.complete ??
      createGeminiComplete(Deno.env.get('GEMINI_API_KEY'), (u, i) => fetch(u, i))

    const configureResult = await googleSheetsConnector.configure!({
      row: { id: provisionId, connector_type: 'google_sheets', config: { ...existingConfig, spreadsheetId } },
      deps: {
        // Token already resolved; hand it back without a second refresh.
        getAccessToken: () => Promise.resolve(accessToken),
        complete,
        sheetsFetcher: deps.sheetsFetcher,
      },
    })

    const sheetTitle = await fetchSheetTitle(spreadsheetId, accessToken, deps.sheetsFetcher)
    const proposedMapping = toProposedMapping({
      headers: configureResult.headers,
      sampleRow: configureResult.sampleRow,
      entries: configureResult.proposedMapping,
      sheetTitle,
    })

    const nextConfig = { ...existingConfig, spreadsheetId, proposedMapping }
    const { error: updateError } = await admin
      .from('automation_provisions')
      .update({ config: nextConfig })
      .eq('id', provisionId)
    if (updateError) {
      return new Response(JSON.stringify({ error: 'persist_failed' }), { status: 500, headers: jsonHeaders })
    }

    return new Response(JSON.stringify({ proposedMapping }), { status: 200, headers: jsonHeaders })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'configure_failed'
    console.error('connect-configure:', message)
    return new Response(JSON.stringify({ error: message }), { status: 502, headers: jsonHeaders })
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleConfigure(req))
}
