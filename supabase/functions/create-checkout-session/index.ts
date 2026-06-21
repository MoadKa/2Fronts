import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@16'
import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { resolveAppBaseUrl } from '../_shared/appUrl.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { requestId } = await req.json()
  if (!requestId) {
    return new Response(JSON.stringify({ error: 'requestId is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Fail fast on a misconfigured redirect origin rather than silently sending
  // paid customers to a broken URL (e.g. a leftover localhost dev value).
  let appBaseUrl: string
  try {
    appBaseUrl = resolveAppBaseUrl(
      Deno.env.get('PUBLIC_APP_URL'),
      Deno.env.get('ALLOW_INSECURE_APP_URL') === 'true',
    )
  } catch (err) {
    console.error('create-checkout-session:', err instanceof Error ? err.message : err)
    return new Response(JSON.stringify({ error: 'Checkout is temporarily unavailable' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // RLS on automation_requests ("customers read own requests") guarantees this
  // only returns a row if the authenticated caller owns it.
  const { data: requestRow, error: requestError } = await userClient
    .from('automation_requests')
    .select('id, automations(name, price_cents, currency)')
    .eq('id', requestId)
    .single()

  if (requestError || !requestRow) {
    return new Response(JSON.stringify({ error: 'Request not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const automation = requestRow.automations as unknown as { name: string; price_cents: number; currency: string }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: automation.currency,
        unit_amount: automation.price_cents,
        product_data: { name: automation.name },
      },
      quantity: 1,
    }],
    metadata: { request_id: requestId },
    success_url: `${appBaseUrl}/checkout/result?status=success`,
    cancel_url: `${appBaseUrl}/checkout/result?status=cancelled`,
  })

  // Service-role client: customers have no UPDATE policy on automation_requests by
  // design (see migration), so this transition is performed server-side only.
  const adminClient = createAdminClient()
  await adminClient
    .from('automation_requests')
    .update({ status: 'payment_pending', stripe_checkout_session_id: session.id })
    .eq('id', requestId)

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
