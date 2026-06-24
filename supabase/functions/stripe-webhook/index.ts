import Stripe from 'npm:stripe@16'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { purchaseNumber } from '../_shared/twilioProvision.ts'
import { type ProvisionAutomation } from '../_shared/provisioning.ts'
import { provisionIfNeeded } from '../_shared/provisionFulfillment.ts'
import { alert, type AlertEvent } from '../_shared/alerting.ts'

export type { ProvisionAutomation }

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

interface WebhookDeps {
  stripe: Pick<Stripe, 'webhooks'>
  createAdminClient: () => SupabaseClient
  provisionAutomation: ProvisionAutomation
  // Ops alerting (ALERT_WEBHOOK_URL). Injectable so payment_failed tests assert
  // the alert without a network call. Never throws (see _shared/alerting.ts).
  alert: (event: AlertEvent) => Promise<boolean>
}

const defaultDeps: WebhookDeps = {
  stripe,
  createAdminClient,
  provisionAutomation: { purchaseNumber },
  alert: (event) => alert(event),
}

export async function handleStripeWebhook(req: Request, deps: WebhookDeps = defaultDeps): Promise<Response> {
  const signature = req.headers.get('stripe-signature') ?? ''
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = (await deps.stripe.webhooks.constructEventAsync(body, signature, webhookSecret)) as Stripe.Event
  } catch {
    return new Response('Invalid signature', { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const requestId = session.metadata?.request_id
    if (requestId) {
      const adminClient = deps.createAdminClient()
      await adminClient
        .from('automation_requests')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('stripe_checkout_session_id', session.id)

      // Subscription sessions carry the new subscription + customer. Store them
      // on the provision so customer.subscription.deleted can later find this
      // concierge by stripe_subscription_id. One-time sessions have neither, so
      // this is a no-op for them (the existing path is unchanged). session.
      // subscription/customer are id strings here (not expanded objects).
      const subscriptionId = idOf(session.subscription)
      if (subscriptionId) {
        const customerId = idOf(session.customer)
        await adminClient
          .from('automation_provisions')
          .update({
            stripe_subscription_id: subscriptionId,
            ...(customerId ? { stripe_customer_id: customerId } : {}),
          })
          .eq('request_id', requestId)
      }

      // Idempotent: provisionIfNeeded claims its transition with a status guard,
      // so a re-delivered completed event does not double-activate.
      await provisionIfNeeded(adminClient, requestId, deps.provisionAutomation)
    }
  }

  // A subscription was cancelled (by the customer, by us, or after dunning).
  // The concierge is digital-only, so deactivation is just flipping is_active
  // off — there is no external resource to release. Find the provision by the
  // stored subscription id, then deactivate the linked concierge and mark the
  // provision cancelled. Idempotent: a re-delivery re-applies the same flags.
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription
    const adminClient = deps.createAdminClient()
    await deactivateSubscription(adminClient, subscription.id)
  }

  // A recurring invoice failed (card declined, etc.). Alert ops so a human can
  // reach out before Stripe's dunning eventually cancels the subscription
  // (which then arrives as customer.subscription.deleted and deactivates the
  // concierge). We do not deactivate here — Stripe retries first.
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice
    const subscriptionId = idOf((invoice as { subscription?: unknown }).subscription)
    if (subscriptionId) {
      await deps.alert({
        type: 'subscription_payment_failed',
        message: `Subscription ${subscriptionId} payment failed`,
        fields: {
          subscriptionId,
          customerId: idOf((invoice as { customer?: unknown }).customer) ?? null,
          invoiceId: invoice.id ?? null,
          amountDue: (invoice as { amount_due?: number }).amount_due ?? null,
        },
      })
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
}

// A Stripe id field is either a string id or an expanded object with `.id`
// (or null when absent). Normalize to the id string or undefined.
function idOf(ref: unknown): string | undefined {
  if (typeof ref === 'string') return ref
  if (ref && typeof ref === 'object' && typeof (ref as { id?: unknown }).id === 'string') {
    return (ref as { id: string }).id
  }
  return undefined
}

// Deactivate the concierge behind a cancelled subscription and mark its
// provision cancelled. Resolves the concierge via the provision's
// config.concierge_id (set by concierge-setup). Safe to call repeatedly.
async function deactivateSubscription(adminClient: SupabaseClient, subscriptionId: string): Promise<void> {
  const { data: provision } = await adminClient
    .from('automation_provisions')
    .select('id, config')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle()
  if (!provision) return

  const config = ((provision as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>
  const conciergeId = typeof config.concierge_id === 'string' ? config.concierge_id : undefined
  if (conciergeId) {
    await adminClient
      .from('concierges')
      .update({ is_active: false })
      .eq('id', conciergeId)
  }

  await adminClient
    .from('automation_provisions')
    .update({ status: 'cancelled' })
    .eq('id', (provision as { id: string }).id)
}

if (import.meta.main) {
  Deno.serve((req) => handleStripeWebhook(req))
}
