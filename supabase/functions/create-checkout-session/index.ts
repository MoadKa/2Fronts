import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@16'
import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { resolveAppBaseUrl } from '../_shared/appUrl.ts'
import { provisionIfNeeded } from '../_shared/provisionFulfillment.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

interface CheckoutDeps {
  stripe: Pick<Stripe, 'checkout' | 'customers'>
  createUserClient: (authHeader: string) => SupabaseClient
  createAdminClient: () => SupabaseClient
  // Server-side fulfillment, shared with the stripe-webhook so the free and paid
  // paths provision identically.
  fulfill: (adminClient: SupabaseClient, requestId: string) => Promise<void>
  getEnv: (key: string) => string | undefined
}

const defaultDeps: CheckoutDeps = {
  stripe,
  createUserClient: (authHeader) =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    }),
  createAdminClient,
  fulfill: provisionIfNeeded,
  getEnv: (key) => Deno.env.get(key),
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export async function handleCreateCheckout(req: Request, deps: CheckoutDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  const userClient = deps.createUserClient(req.headers.get('Authorization') ?? '')

  const { requestId } = await req.json()
  if (!requestId) return json({ error: 'requestId is required' }, 400)

  // Fail fast on a misconfigured redirect origin rather than silently sending
  // customers to a broken URL (e.g. a leftover localhost dev value).
  let appBaseUrl: string
  try {
    appBaseUrl = resolveAppBaseUrl(deps.getEnv('PUBLIC_APP_URL'), deps.getEnv('ALLOW_INSECURE_APP_URL') === 'true')
  } catch (err) {
    console.error('create-checkout-session:', err instanceof Error ? err.message : err)
    return json({ error: 'Checkout is temporarily unavailable' }, 500)
  }

  // RLS on automation_requests ("customers read own requests") guarantees this
  // only returns a row if the authenticated caller owns it. We also pull the
  // pricing model (one_time vs subscription) and the owning customer's email so
  // a subscription checkout can attach a named Stripe Customer.
  const { data: requestRow, error: requestError } = await userClient
    .from('automation_requests')
    .select('id, automations(name, price_cents, currency, pricing_model, recurring_interval), profiles(email)')
    .eq('id', requestId)
    .single()

  if (requestError || !requestRow) return json({ error: 'Request not found' }, 404)

  const automation = requestRow.automations as unknown as {
    name: string
    price_cents: number
    currency: string
    // Defaulted by the DB to 'one_time'; older clients/tests may omit it, so we
    // treat anything other than 'subscription' as the existing one-time path.
    pricing_model?: string | null
    recurring_interval?: string | null
  }
  const profile = (requestRow as { profiles?: unknown }).profiles
  const customerEmail = ((Array.isArray(profile) ? profile[0] : profile) as { email?: string } | null)?.email
  const adminClient = deps.createAdminClient()

  // Free automations (price 0) skip Stripe entirely: Stripe rejects zero-amount
  // charges, and a free tier / test offering must not require a card. Fulfill the
  // request server-side exactly as the stripe-webhook does on a paid session,
  // then send the customer to the same success page.
  if (automation.price_cents === 0) {
    await adminClient
      .from('automation_requests')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', requestId)
    await deps.fulfill(adminClient, requestId)
    return json({ url: `${appBaseUrl}/checkout/result?status=success` })
  }

  // Subscription automations (the AI Booking Concierge) bill monthly, so they
  // need a mode:'subscription' session with a RECURRING inline price_data and a
  // named Stripe Customer (so the subscription is attributable and a future
  // billing-portal link has a customer to point at). One-time SKUs fall through
  // to the unchanged mode:'payment' path below.
  if (automation.pricing_model === 'subscription') {
    // Create the Customer up front so we can store the id even before the
    // subscription exists; Stripe will reuse it for the subscription's invoices.
    const customer = await deps.stripe.customers.create({
      email: customerEmail,
      metadata: { request_id: requestId },
    })

    const session = await deps.stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customer.id,
      line_items: [{
        price_data: {
          currency: automation.currency,
          unit_amount: automation.price_cents,
          product_data: { name: automation.name },
          recurring: { interval: (automation.recurring_interval ?? 'month') as Stripe.PriceCreateParams.Recurring.Interval },
        },
        quantity: 1,
      }],
      // request_id rides on both the session and the subscription so the webhook
      // can map either back to this request without a DB lookup.
      metadata: { request_id: requestId },
      // No trial: the customer is charged the plan price immediately at checkout,
      // then billed recurrently at the chosen interval until cancelled.
      subscription_data: { metadata: { request_id: requestId } },
      success_url: `${appBaseUrl}/checkout/result?status=success`,
      cancel_url: `${appBaseUrl}/checkout/result?status=cancelled`,
    })

    // Persist the Stripe customer id now; the subscription id is stored on
    // checkout.session.completed by the webhook. Service-role client because
    // customers have no UPDATE policy on these tables by design.
    await adminClient
      .from('automation_requests')
      .update({ status: 'payment_pending', stripe_checkout_session_id: session.id })
      .eq('id', requestId)
    await adminClient
      .from('automation_provisions')
      .update({ stripe_customer_id: customer.id })
      .eq('request_id', requestId)

    return json({ url: session.url })
  }

  const session = await deps.stripe.checkout.sessions.create({
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
  await adminClient
    .from('automation_requests')
    .update({ status: 'payment_pending', stripe_checkout_session_id: session.id })
    .eq('id', requestId)

  return json({ url: session.url })
}

if (import.meta.main) {
  Deno.serve((req) => handleCreateCheckout(req))
}
