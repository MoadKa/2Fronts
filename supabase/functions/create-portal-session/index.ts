import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@16'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveAppBaseUrl } from '../_shared/appUrl.ts'

// create-portal-session: opens the Stripe Billing Portal so a subscriber can
// update their card, see invoices, and CANCEL — self-serve. Authed (verify_jwt
// stays on): a customer may only open the portal for THEIR OWN provision, which
// RLS guarantees (the userClient read returns a row only if the caller owns it).
// The portal customer comes from the stored stripe_customer_id; we never trust a
// customer id from the request body. Required for the German Kündigungsbutton
// (§312k BGB) and to recover declined cards before churn.

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

export interface PortalDeps {
  stripe: Pick<Stripe, 'billingPortal'>
  createUserClient: (authHeader: string) => SupabaseClient
  getEnv: (key: string) => string | undefined
}

const defaultDeps: PortalDeps = {
  stripe,
  createUserClient: (authHeader) =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    }),
  getEnv: (key) => Deno.env.get(key),
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export async function handleCreatePortal(req: Request, deps: PortalDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ error: 'unauthorized' }, 401)

  let provisionId = ''
  try {
    provisionId = String((await req.json()).provisionId ?? '').trim()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  if (!provisionId) return json({ error: 'provisionId is required' }, 400)

  let appBaseUrl: string
  try {
    appBaseUrl = resolveAppBaseUrl(deps.getEnv('PUBLIC_APP_URL'), deps.getEnv('ALLOW_INSECURE_APP_URL') === 'true')
  } catch {
    return json({ error: 'unavailable' }, 500)
  }

  // RLS: this returns a row only if the authenticated caller owns the provision.
  const userClient = deps.createUserClient(authHeader)
  const { data: provision } = await userClient
    .from('automation_provisions')
    .select('stripe_customer_id')
    .eq('id', provisionId)
    .maybeSingle()

  const customerId = (provision as { stripe_customer_id?: string | null } | null)?.stripe_customer_id
  // No row (not owned / not found) or no Stripe customer (not a subscription) →
  // nothing to manage. Same 404 for both so we don't leak which provisions exist.
  if (!customerId) return json({ error: 'no_subscription' }, 404)

  try {
    const session = await deps.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appBaseUrl}/my-requests`,
    })
    return json({ url: session.url })
  } catch (err) {
    console.error('create-portal-session:', err instanceof Error ? err.message : err)
    return json({ error: 'portal_unavailable' }, 502)
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleCreatePortal(req))
}
