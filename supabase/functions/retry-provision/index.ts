import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getConnector, type ConnectorDeps, type ProvisionRow } from '../_shared/connectors.ts'
import { runConnectorProvision } from '../_shared/provisioning.ts'
import { corsHeaders } from '../_shared/cors.ts'

interface RetryDeps {
  createUserClient: (authHeader: string) => SupabaseClient
  // Forwarded to the connector that owns this provision. Was the Twilio number
  // purchaser until the SMS product was removed (2026-08-07); the retry is now
  // generic and works for whichever connector the row carries.
  connectorDeps?: ConnectorDeps
}

function defaultCreateUserClient(authHeader: string): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
}

const defaultDeps: RetryDeps = {
  createUserClient: defaultCreateUserClient,
  connectorDeps: {},
}

// Authorization: the caller's JWT is forwarded into a user-scoped Supabase
// client (same pattern as create-checkout-session). The "admins update
// provisions" RLS policy is the actual security boundary -- a non-admin
// caller's update simply matches 0 rows (claimSucceeds path), this is
// convenience routing, not the enforcement mechanism.
export async function handleRetryProvision(req: Request, deps: RetryDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const { requestId } = await req.json()
  if (!requestId) {
    return new Response(JSON.stringify({ error: 'requestId is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = deps.createUserClient(authHeader)

  const { data: provisionRow } = await userClient
    .from('automation_provisions')
    .select('id, connector_type, business_name, booking_link, config, status')
    .eq('request_id', requestId)
    .single()

  const row = provisionRow as (ProvisionRow & { status: string }) | null
  if (!row || row.status !== 'failed') {
    return new Response(JSON.stringify({ error: 'No failed provision found for this request' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // A row whose connector is retired (or which predates connector_type) cannot
  // be retried. Answer 409 rather than letting getConnector's throw surface as
  // an opaque 500 -- the admin clicking Retry should learn it is unretryable.
  let connector
  try {
    connector = getConnector(row.connector_type)
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const result = await runConnectorProvision(
    userClient,
    connector,
    row,
    'failed',
    deps.connectorDeps ?? {},
  )

  return new Response(JSON.stringify({ status: result }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

if (import.meta.main) {
  Deno.serve((req) => handleRetryProvision(req))
}
