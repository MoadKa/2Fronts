// confirm-mapping: persists the customer's confirmed column mapping onto the
// provision. The confirm screen used to write this straight from the browser,
// but RLS on automation_provisions only permits server-side (admin) writes — so
// the client UPDATE silently failed and no lead could ever be filed. This moves
// the write server-side: verify the caller owns the provision (JWT uid ==
// provision's customer), then write config.columnMapping + status via the admin
// client, mirroring how connect-configure already works.
//
// All external effects are injected so the handler is unit-tested offline.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

interface ConfirmedFieldMapping {
  field: string
  column: string | null
}

export interface ConfirmDeps {
  createAdminClient: () => SupabaseClient
  getUserId: (authHeader: string) => Promise<string | null>
}

async function defaultGetUserId(authHeader: string): Promise<string | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon || !authHeader) return null
  const client = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const { data } = await client.auth.getUser()
  return data.user?.id ?? null
}

const defaultDeps: ConfirmDeps = { createAdminClient, getUserId: defaultGetUserId }

// A confirmed mapping is a non-empty array of { field: string, column: string|null }.
function parseMapping(value: unknown): ConfirmedFieldMapping[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const out: ConfirmedFieldMapping[] = []
  for (const e of value) {
    if (!e || typeof e !== 'object') return null
    const field = (e as { field?: unknown }).field
    const column = (e as { column?: unknown }).column
    if (typeof field !== 'string') return null
    if (column !== null && typeof column !== 'string') return null
    out.push({ field, column })
  }
  return out
}

export async function handleConfirmMapping(req: Request, deps: ConfirmDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders })
  }

  let body: { provisionId?: unknown; columnMapping?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders })
  }

  const provisionId = typeof body.provisionId === 'string' ? body.provisionId : ''
  if (!provisionId) {
    return new Response(JSON.stringify({ error: 'provisionId is required' }), { status: 400, headers: jsonHeaders })
  }
  const columnMapping = parseMapping(body.columnMapping)
  if (!columnMapping) {
    return new Response(JSON.stringify({ error: 'invalid_mapping' }), { status: 400, headers: jsonHeaders })
  }

  // Authz: the caller must be the customer who owns this provision.
  const uid = await deps.getUserId(req.headers.get('Authorization') ?? '')
  if (!uid) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  const admin = deps.createAdminClient()
  const { data: prov, error: provErr } = await admin
    .from('automation_provisions')
    .select('config, automation_requests(customer_id)')
    .eq('id', provisionId)
    .maybeSingle()
  if (provErr || !prov) {
    return new Response(JSON.stringify({ error: 'provision_not_found' }), { status: 404, headers: jsonHeaders })
  }
  const rel = (prov as { automation_requests?: unknown }).automation_requests
  const reqRow = (Array.isArray(rel) ? rel[0] : rel) as { customer_id?: string } | undefined
  if (!reqRow?.customer_id) {
    return new Response(JSON.stringify({ error: 'provision_not_found' }), { status: 404, headers: jsonHeaders })
  }
  if (reqRow.customer_id !== uid) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: jsonHeaders })
  }

  // Merge into existing config (preserve proposedMapping + spreadsheetId) and
  // advance the provision so fulfillment can proceed.
  const existingConfig = ((prov as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>
  const nextConfig = { ...existingConfig, columnMapping, mappingConfirmedAt: new Date().toISOString() }

  const { error: updErr } = await admin
    .from('automation_provisions')
    .update({ config: nextConfig, status: 'provisioning' })
    .eq('id', provisionId)
  if (updErr) {
    return new Response(JSON.stringify({ error: 'persist_failed' }), { status: 500, headers: jsonHeaders })
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: jsonHeaders })
}

if (import.meta.main) {
  Deno.serve((req) => handleConfirmMapping(req))
}
