import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { purchaseNumber } from '../_shared/twilioProvision.ts'
import { attemptProvision, type ProvisionAutomation } from '../_shared/provisioning.ts'
import { corsHeaders } from '../_shared/cors.ts'

export type { ProvisionAutomation }

interface RetryDeps {
  createUserClient: (authHeader: string) => SupabaseClient
  provisionAutomation: ProvisionAutomation
}

function defaultCreateUserClient(authHeader: string): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
}

const defaultDeps: RetryDeps = {
  createUserClient: defaultCreateUserClient,
  provisionAutomation: { purchaseNumber },
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
    .select('id, business_name, status')
    .eq('request_id', requestId)
    .single()

  const row = provisionRow as { id: string; business_name: string; status: string } | null
  if (!row || row.status !== 'failed') {
    return new Response(JSON.stringify({ error: 'No failed provision found for this request' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const result = await attemptProvision(userClient, row, 'failed', deps.provisionAutomation)

  return new Response(JSON.stringify({ status: result }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

if (import.meta.main) {
  Deno.serve(handleRetryProvision)
}
