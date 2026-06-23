// slack-configure: the step that turns "I connected Slack" into "here is the
// channel to post leads to". Two actions on one provision the caller owns:
//   action 'list'    -> run the connector's configure() (conversations.list) and
//                       return the channels to choose from.
//   action 'confirm' -> persist the chosen channel onto config.channelId and
//                       advance the provision so fulfillment can proceed.
//
// Mirrors connect-configure + confirm-mapping: JWT-owns-provision authz, a live
// Slack token pulled from the stored connection, and admin-client writes (RLS on
// automation_provisions only permits server-side writes). All external effects
// are injected so the handler is unit-tested offline.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { getSlackTokenForCustomer } from '../_shared/slackAuth.ts'
import { slackConnector, type SlackFetcher } from '../_shared/slackConnector.ts'

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

export interface SlackConfigureDeps {
  createAdminClient: () => SupabaseClient
  getUserId: (authHeader: string) => Promise<string | null>
  getSlackToken: (admin: SupabaseClient, customerId: string) => Promise<string>
  slackFetcher: SlackFetcher
}

async function defaultGetUserId(authHeader: string): Promise<string | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon || !authHeader) return null
  const client = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const { data } = await client.auth.getUser()
  return data.user?.id ?? null
}

const defaultDeps: SlackConfigureDeps = {
  createAdminClient,
  getUserId: defaultGetUserId,
  getSlackToken: (admin, customerId) => getSlackTokenForCustomer(admin, customerId),
  slackFetcher: (url, init) => fetch(url, init),
}

// Resolve the provision's config + owning customer, enforcing the caller owns it.
async function loadOwnedProvision(
  admin: SupabaseClient,
  provisionId: string,
  uid: string,
): Promise<{ config: Record<string, unknown>; customerId: string } | { error: Response }> {
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
  return { config, customerId }
}

export async function handleSlackConfigure(req: Request, deps: SlackConfigureDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders })
  }

  let body: { provisionId?: unknown; action?: unknown; channelId?: unknown; channelName?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders })
  }

  const provisionId = typeof body.provisionId === 'string' ? body.provisionId : ''
  const action = body.action === 'confirm' ? 'confirm' : 'list'
  if (!provisionId) {
    return new Response(JSON.stringify({ error: 'provisionId is required' }), { status: 400, headers: jsonHeaders })
  }

  const uid = await deps.getUserId(req.headers.get('Authorization') ?? '')
  if (!uid) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  const admin = deps.createAdminClient()
  const loaded = await loadOwnedProvision(admin, provisionId, uid)
  if ('error' in loaded) return loaded.error

  try {
    if (action === 'confirm') {
      const channelId = typeof body.channelId === 'string' ? body.channelId : ''
      const channelName = typeof body.channelName === 'string' ? body.channelName : null
      if (!channelId) {
        return new Response(JSON.stringify({ error: 'channelId is required' }), { status: 400, headers: jsonHeaders })
      }
      const nextConfig = {
        ...loaded.config,
        channelId,
        channelName,
        channelConfirmedAt: new Date().toISOString(),
      }
      const { error: updErr } = await admin
        .from('automation_provisions')
        .update({ config: nextConfig, status: 'provisioning' })
        .eq('id', provisionId)
      if (updErr) {
        return new Response(JSON.stringify({ error: 'persist_failed' }), { status: 500, headers: jsonHeaders })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: jsonHeaders })
    }

    // action 'list': run the connector's configure() to list channels.
    const accessToken = await deps.getSlackToken(admin, loaded.customerId)
    const result = await slackConnector.configure!({
      row: { id: provisionId, connector_type: 'slack_notifications', config: loaded.config },
      deps: { getAccessToken: () => Promise.resolve(accessToken), slackFetcher: deps.slackFetcher },
    })

    const channels = result.headers.map((name, i) => ({ id: result.sampleRow[i], name }))
    return new Response(JSON.stringify({ channels }), { status: 200, headers: jsonHeaders })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'slack_configure_failed'
    console.error('slack-configure:', message)
    return new Response(JSON.stringify({ error: message }), { status: 502, headers: jsonHeaders })
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleSlackConfigure(req))
}
