// concierge-setup: link a freshly-created concierge to its provision (#24).
//
// After a coach buys the AI Booking Concierge and fills the setup form, the
// browser creates the concierges row directly (RLS lets an owner write their
// own). But the provision -> concierge link lives on automation_provisions.config,
// which customers cannot UPDATE (RLS: only admins / the service-role client).
// So this small function does that one server-side write, gated by JWT-owns-
// provision authz — exactly the posture of slack-configure's 'confirm' action.
//
// All external effects are injected so the handler is unit-tested offline.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

export interface ConciergeSetupDeps {
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

const defaultDeps: ConciergeSetupDeps = {
  createAdminClient,
  getUserId: defaultGetUserId,
}

// Resolve the provision's config + owning customer, enforcing the caller owns it.
// Mirrors slack-configure's loadOwnedProvision.
async function loadOwnedProvision(
  admin: SupabaseClient,
  provisionId: string,
  uid: string,
): Promise<{ config: Record<string, unknown> } | { error: Response }> {
  const { data, error } = await admin
    .from('automation_provisions')
    .select('config, automation_requests(customer_id)')
    .eq('id', provisionId)
    .maybeSingle()
  if (error || !data) {
    return { error: new Response(JSON.stringify({ error: 'provision_not_found' }), { status: 404, headers: jsonHeaders }) }
  }
  const rel = (data as { automation_requests?: unknown }).automation_requests
  const reqRow = (Array.isArray(rel) ? rel[0] : rel) as { customer_id?: string } | undefined
  const customerId = reqRow?.customer_id
  if (!customerId) {
    return { error: new Response(JSON.stringify({ error: 'provision_not_found' }), { status: 404, headers: jsonHeaders }) }
  }
  if (customerId !== uid) {
    return { error: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: jsonHeaders }) }
  }
  const config = ((data as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>
  return { config }
}

export async function handleConciergeSetup(req: Request, deps: ConciergeSetupDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: jsonHeaders })
  }

  let body: { provisionId?: unknown; conciergeId?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: jsonHeaders })
  }

  const provisionId = typeof body.provisionId === 'string' ? body.provisionId : ''
  const conciergeId = typeof body.conciergeId === 'string' ? body.conciergeId : ''
  if (!provisionId || !conciergeId) {
    return new Response(JSON.stringify({ error: 'provisionId and conciergeId are required' }), { status: 400, headers: jsonHeaders })
  }

  const uid = await deps.getUserId(req.headers.get('Authorization') ?? '')
  if (!uid) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  const admin = deps.createAdminClient()
  const loaded = await loadOwnedProvision(admin, provisionId, uid)
  if ('error' in loaded) return loaded.error

  // Merge the link into config without dropping any existing keys, and advance
  // the provision so fulfillment can proceed (the connector's provision is a
  // no-op success, so this is the meaningful "setup done" signal).
  const nextConfig = { ...loaded.config, concierge_id: conciergeId, conciergeLinkedAt: new Date().toISOString() }
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
  Deno.serve((req) => handleConciergeSetup(req))
}
