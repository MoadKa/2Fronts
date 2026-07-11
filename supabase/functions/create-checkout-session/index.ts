import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@16'
import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { resolveAppBaseUrl } from '../_shared/appUrl.ts'
import { provisionIfNeeded } from '../_shared/provisionFulfillment.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

// 14-day free trial for first-time subscribers (see AGB trial clauses + the
// trialNote copy on the detail/catalog pages — keep all of them in sync).
const TRIAL_PERIOD_DAYS = 14

interface CheckoutDeps {
  stripe: Pick<Stripe, 'checkout' | 'customers' | 'subscriptions'>
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
  // pricing model (one_time vs subscription) plus the owning customer's email
  // and stored Stripe customer id so a subscription checkout can attach a
  // named, reused Stripe Customer.
  const { data: requestRow, error: requestError } = await userClient
    .from('automation_requests')
    .select('id, status, customer_id, automations(name, price_cents, currency, pricing_model, recurring_interval, connector_type), profiles(email, stripe_customer_id)')
    .eq('id', requestId)
    .single()

  if (requestError || !requestRow) return json({ error: 'Request not found' }, 404)

  // A request that already completed must never reach Stripe again: a second
  // session would double-charge a one-time SKU or mint a second subscription
  // for the same purchase.
  if ((requestRow as { status?: string }).status === 'paid') {
    return json({ error: 'Request already completed' }, 409)
  }

  const automation = requestRow.automations as unknown as {
    name: string
    price_cents: number
    currency: string
    // Defaulted by the DB to 'one_time'; older clients/tests may omit it, so we
    // treat anything other than 'subscription' as the existing one-time path.
    pricing_model?: string | null
    recurring_interval?: string | null
    connector_type?: string | null
  }
  const profile = (requestRow as { profiles?: unknown }).profiles
  const profileRow = (Array.isArray(profile) ? profile[0] : profile) as
    | { email?: string; stripe_customer_id?: string | null }
    | null
  const customerEmail = profileRow?.email
  const customerId = (requestRow as { customer_id?: string }).customer_id
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
    // One Stripe Customer per coach: reuse the id stored on the profile so a
    // repeat checkout doesn't mint a duplicate Customer. Create + persist it
    // only when none is stored yet; Stripe reuses it for the subscription's
    // invoices either way.
    let stripeCustomerId = profileRow?.stripe_customer_id ?? null
    // Whether the id predates this request (stored, or a concurrent winner's).
    // Only a re-used Customer can carry subscription history on Stripe's side;
    // a Customer we just created cannot.
    let reusedCustomer = stripeCustomerId !== null
    if (!stripeCustomerId) {
      const customer = await deps.stripe.customers.create({
        email: customerEmail,
        metadata: { request_id: requestId },
      })
      stripeCustomerId = customer.id
      // Race guard: two concurrent checkouts can both see "no stored id" and
      // both create a Customer. The `.is(null)` filter lets only the first
      // persist win; the loser matches zero rows, re-reads the profile, and
      // uses the winner's id so both sessions attach to the same Customer.
      // Persisting is reuse-bookkeeping, not a checkout precondition, so any
      // error here is logged and checkout proceeds with the fresh Customer.
      try {
        const { data: persisted, error: persistError } = await adminClient
          .from('profiles')
          .update({ stripe_customer_id: stripeCustomerId })
          .eq('id', customerId)
          .is('stripe_customer_id', null)
          .select()
        if (persistError) throw persistError
        if ((persisted ?? []).length === 0) {
          const { data: winnerProfile } = await adminClient
            .from('profiles')
            .select('stripe_customer_id')
            .eq('id', customerId)
            .single()
          const winnerId = (winnerProfile as { stripe_customer_id?: string | null } | null)?.stripe_customer_id
          if (winnerId) {
            stripeCustomerId = winnerId
            reusedCustomer = true
          }
        }
      } catch (err) {
        console.error(
          'create-checkout-session: persisting stripe_customer_id failed, proceeding with fresh customer:',
          err instanceof Error ? err.message : err,
        )
      }
    }

    // 14-day trial only for first-time subscribers: anyone whose provisions
    // already carry a Stripe subscription id has subscribed before, so a
    // cancel-and-resubscribe never earns a second free trial. Fail closed: if
    // the eligibility lookup errors we grant NO trial rather than block the
    // checkout.
    let trialEligible = false
    try {
      const { data: priorSubs, error: priorError } = await adminClient
        .from('automation_provisions')
        .select('id, automation_requests!inner(customer_id)')
        .not('stripe_subscription_id', 'is', null)
        .eq('automation_requests.customer_id', customerId)
        .limit(1)
      if (priorError) throw priorError
      trialEligible = (priorSubs ?? []).length === 0
    } catch (err) {
      console.error(
        'create-checkout-session: trial eligibility lookup failed, granting no trial:',
        err instanceof Error ? err.message : err,
      )
    }

    // Second, independent verdict from Stripe itself: the DB only knows about
    // subscriptions the webhook recorded, so a re-used Customer is also checked
    // against Stripe's own subscription history (any status, including
    // cancelled) — any hit means this coach already had their first-time
    // moment. A Stripe outage must never crash checkout: on error the Stripe
    // check simply contributes nothing and the DB verdict above stands.
    if (trialEligible && reusedCustomer) {
      try {
        const { data: stripeSubs } = await deps.stripe.subscriptions.list({
          customer: stripeCustomerId,
          status: 'all',
          limit: 1,
        })
        if ((stripeSubs ?? []).length > 0) trialEligible = false
      } catch (err) {
        console.error(
          'create-checkout-session: Stripe subscription-history lookup failed, keeping DB trial verdict:',
          err instanceof Error ? err.message : err,
        )
      }
    }

    // Self-heal the provision row. The client normally inserts it right after
    // createRequest, but if that insert was skipped (older client, direct API
    // call, or a failed request) the webhook's subscription-id update would
    // match zero rows and the live subscription would go untracked. Ensure a
    // minimal pending row exists before the coach is sent to Stripe; the
    // failure of this best-effort repair must not block checkout (the webhook
    // now alerts on a missing provision as the backstop).
    try {
      const { data: provision, error: provisionSelectError } = await adminClient
        .from('automation_provisions')
        .select('id')
        .eq('request_id', requestId)
        .maybeSingle()
      if (provisionSelectError) throw provisionSelectError
      if (!provision) {
        const { error: provisionInsertError } = await adminClient
          .from('automation_provisions')
          .insert({
            request_id: requestId,
            // Derive from the purchased automation (as the client does); fall
            // back to the DB default when an older row predates the column.
            ...(automation.connector_type ? { connector_type: automation.connector_type } : {}),
            status: 'pending',
          })
        if (provisionInsertError) throw provisionInsertError
      }
    } catch (err) {
      console.error(
        'create-checkout-session: provision self-heal failed:',
        err instanceof Error ? err.message : err,
      )
    }

    // Trial checkouts land on a trial-specific success page (`trial=1`): no
    // money moved yet, so "Zahlung erhalten" would be wrong copy.
    const successUrl = trialEligible
      ? `${appBaseUrl}/checkout/result?status=success&trial=1`
      : `${appBaseUrl}/checkout/result?status=success`

    const sessionParams = (stripeCustomer: string): Stripe.Checkout.SessionCreateParams => ({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: stripeCustomer,
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
      // 14-day free trial for first-time subscribers: the customer enters a
      // card now, is charged nothing during the trial, then auto-billed at the
      // plan price when it ends. Returning subscribers (trialEligible=false)
      // are charged the plan price immediately at checkout; both are billed
      // recurrently at the chosen interval until cancelled.
      subscription_data: trialEligible
        ? { metadata: { request_id: requestId }, trial_period_days: TRIAL_PERIOD_DAYS }
        : { metadata: { request_id: requestId } },
      success_url: successUrl,
      cancel_url: `${appBaseUrl}/checkout/result?status=cancelled`,
    })

    let session: Stripe.Checkout.Session
    try {
      session = await deps.stripe.checkout.sessions.create(sessionParams(stripeCustomerId))
    } catch (err) {
      // A stored Customer id can go stale (deleted in the Stripe dashboard,
      // or a test-mode id in live mode). Stripe reports that as
      // resource_missing on the customer param: clear the stale id, mint a
      // fresh Customer, persist it, and retry the session once. Any other
      // error still propagates.
      const stripeErr = err as { code?: string; param?: string }
      if (stripeErr.code !== 'resource_missing' || stripeErr.param !== 'customer') throw err
      console.error(`create-checkout-session: stored Stripe customer ${stripeCustomerId} no longer exists, re-creating`)
      await adminClient
        .from('profiles')
        .update({ stripe_customer_id: null })
        .eq('id', customerId)
      const customer = await deps.stripe.customers.create({
        email: customerEmail,
        metadata: { request_id: requestId },
      })
      stripeCustomerId = customer.id
      await adminClient
        .from('profiles')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', customerId)
      session = await deps.stripe.checkout.sessions.create(sessionParams(stripeCustomerId))
    }

    // Persist the Stripe customer id now; the subscription id is stored on
    // checkout.session.completed by the webhook. Service-role client because
    // customers have no UPDATE policy on these tables by design.
    await adminClient
      .from('automation_requests')
      .update({ status: 'payment_pending', stripe_checkout_session_id: session.id })
      .eq('id', requestId)
    await adminClient
      .from('automation_provisions')
      .update({ stripe_customer_id: stripeCustomerId })
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
