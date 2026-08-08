import Stripe from 'npm:stripe@16'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { type ConnectorDeps } from '../_shared/connectors.ts'
import { provisionIfNeeded } from '../_shared/provisionFulfillment.ts'
import { alert, type AlertEvent } from '../_shared/alerting.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

interface WebhookDeps {
  stripe: Pick<Stripe, 'webhooks'>
  createAdminClient: () => SupabaseClient
  // Forwarded verbatim to whichever connector fulfills the provision. Empty by
  // default; each connector reads only the deps it needs.
  connectorDeps?: ConnectorDeps
  // Ops alerting (ALERT_WEBHOOK_URL). Injectable so payment_failed tests assert
  // the alert without a network call. Never throws (see _shared/alerting.ts).
  alert: (event: AlertEvent) => Promise<boolean>
}

const defaultDeps: WebhookDeps = {
  stripe,
  createAdminClient,
  connectorDeps: {},
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
      // Guarded so a CANCELLED request cannot be promoted back to 'paid'.
      // Delisting an automation (see 20260807160000) cancels its in-flight
      // requests, but Checkout Sessions already open at Stripe stay live: a
      // customer who completes one afterwards is really charged. Without this
      // guard the cancelled request silently flips to 'paid' and fulfillment
      // then fails, taking money for something that cannot be delivered.
      // Promote ONLY from a pre-payment status. Guarding with
      // .not('status','eq','cancelled') instead would re-stamp paid_at on every
      // re-delivery and silently revert a request an admin had already advanced
      // to 'in_progress' or 'delivered' back to 'paid'.
      const { data: promoted, error: promoteError } = await adminClient
        .from('automation_requests')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('stripe_checkout_session_id', session.id)
        .in('status', ['requested', 'payment_pending'])
        .select()

      // A transient DB failure must NOT be read as "zero rows". Swallowing it
      // here reports a real payment to ops as "this request does not exist" and
      // answers Stripe 200, so the event is never redelivered and the purchase
      // is permanently lost. Throwing gives Stripe its retry.
      if (promoteError) throw promoteError

      if (((promoted as unknown[] | null) ?? []).length === 0) {
        // Zero affected rows has four distinct causes needing different human
        // responses, so name the actual one instead of asserting the rarest.
        const { data: actual, error: reReadError } = await adminClient
          .from('automation_requests')
          .select('status, stripe_checkout_session_id')
          .eq('id', requestId)
          .maybeSingle()

        if (reReadError) throw reReadError

        const current = actual as
          | { status?: string; stripe_checkout_session_id?: string | null }
          | null

        if (!current) {
          await deps.alert({
            type: 'payment_for_unknown_request',
            message: `checkout.session.completed names request ${requestId}, which does not exist. Session ${session.id} may have been charged against a deleted request, or this is a test-mode event hitting production.`,
            fields: { requestId, sessionId: session.id },
          })
        } else if (current.status === 'cancelled') {
          await deps.alert({
            type: 'payment_on_cancelled_request',
            message: `Request ${requestId} is CANCELLED but Stripe session ${session.id} completed. The customer was charged for something that cannot be delivered — refund required.`,
            fields: { requestId, sessionId: session.id },
          })
        } else if (current.stripe_checkout_session_id !== session.id) {
          // create-checkout-session best-effort-expires the previous session and
          // swallows failure, so two sessions can be live at once. Paying the old
          // one lands here. This is a legitimate purchase, NOT a refund case.
          // Two very different situations share this branch, and they need
          // opposite responses. Pre-payment: one legitimate charge on a
          // superseded session, reconcile the id. Post-payment: the request was
          // ALREADY paid on a different session, so the customer completed two
          // sessions for one purchase — a real double charge that does need a
          // refund. Hardcoding "do NOT refund" sent ops the wrong way.
          const settled = ['paid', 'in_progress', 'delivered'].includes(current.status ?? '')
          await deps.alert({
            type: settled ? 'double_charge_suspected' : 'payment_on_stale_session',
            message: settled
              ? `Request ${requestId} is already '${current.status}' on session ${current.stripe_checkout_session_id}, but session ${session.id} ALSO completed. The customer was very likely charged twice for one purchase — verify both payment intents in Stripe and refund the duplicate.`
              : `Request ${requestId} completed on session ${session.id}, but the request holds ${current.stripe_checkout_session_id}. A legitimate payment on a superseded session: the request is stuck at '${current.status}' with paid_at null. Do NOT refund; reconcile the session id.`,
            fields: { requestId, sessionId: session.id, storedSessionId: current.stripe_checkout_session_id ?? null, currentStatus: current.status ?? null },
          })
        }
        // Nothing below may run for a request that is NOT already past payment.
        // The subscription store, the self-heal INSERT and provisionIfNeeded
        // would otherwise deliver the product anyway: concierge live, request
        // still reading 'cancelled', paid_at null.
        //
        // The one case that falls through is an ordinary Stripe re-delivery: the
        // request is already 'paid' (or an admin has moved it to 'in_progress' /
        // 'delivered') on THIS session id. That must keep running, because the
        // subscription store and the self-heal are exactly what a retry after a
        // 500 needs to complete. Silent by design.
        const alreadySettled =
          current !== null &&
          current.stripe_checkout_session_id === session.id &&
          ['paid', 'in_progress', 'delivered'].includes(current.status ?? '')

        if (!alreadySettled) {
          return new Response(JSON.stringify({ received: true }), { status: 200 })
        }
      }

      // Subscription sessions carry the new subscription + customer. Store them
      // on the provision so customer.subscription.deleted can later find this
      // concierge by stripe_subscription_id. One-time sessions have neither, so
      // this is a no-op for them (the existing path is unchanged). session.
      // subscription/customer are id strings here (not expanded objects).
      const subscriptionId = idOf(session.subscription)
      if (subscriptionId) {
        const customerId = idOf(session.customer)
        // Never clobber a DIFFERENT already-stored subscription id: overwriting
        // it would orphan the earlier subscription (its cancellation event
        // could no longer find this provision). Alert ops instead — two
        // subscriptions on one request is a state a human must untangle.
        const { data: provision } = await adminClient
          .from('automation_provisions')
          .select('id, stripe_subscription_id')
          .eq('request_id', requestId)
          .maybeSingle()
        const storedSubscriptionId =
          (provision as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id ?? null

        if (storedSubscriptionId && storedSubscriptionId !== subscriptionId) {
          await deps.alert({
            type: 'subscription_conflict',
            message: `Request ${requestId} provision already carries subscription ${storedSubscriptionId}, refusing to overwrite with ${subscriptionId}`,
            fields: { requestId, storedSubscriptionId, incomingSubscriptionId: subscriptionId },
          })
        } else {
          const { data: updated } = await adminClient
            .from('automation_provisions')
            .update({
              stripe_subscription_id: subscriptionId,
              ...(customerId ? { stripe_customer_id: customerId } : {}),
            })
            .eq('request_id', requestId)
            .select()
          // Zero affected rows means there is no provision row at all: the
          // subscription is live on Stripe but untracked here (cancellation
          // would silently no-op). Self-heal: insert a minimal pending row
          // carrying the subscription id so the lifecycle events can find it
          // again — and STILL alert ops either way, because a request without
          // a provision at webhook time means an upstream insert was skipped
          // and a human should know. Insert failure (e.g. a unique race with
          // a concurrent delivery) keeps the alert and never throws: Stripe
          // must get its 200.
          if (((updated as unknown[] | null) ?? []).length === 0) {
            let selfHealed = false
            try {
              // Derive connector_type from the purchased automation, as
              // create-checkout-session's self-heal does.
              //
              // The column's DB default was dropped on 2026-08-07 (it was the
              // now-retired 'twilio_missed_call'), so if this lookup comes back
              // empty the insert below omits a NOT NULL column and throws. That
              // is intentional: the throw is caught, ops gets a provision_missing
              // alert, and Stripe still gets its 200. A silently defaulted row
              // would have been born unfulfillable instead.
              const { data: requestRow } = await adminClient
                .from('automation_requests')
                .select('automations(connector_type)')
                .eq('id', requestId)
                .single()
              const automations = (requestRow as { automations?: unknown } | null)?.automations
              const automation = (Array.isArray(automations) ? automations[0] : automations) as
                | { connector_type?: string | null }
                | null
              const { error: insertError } = await adminClient
                .from('automation_provisions')
                .insert({
                  request_id: requestId,
                  ...(automation?.connector_type ? { connector_type: automation.connector_type } : {}),
                  status: 'pending',
                  stripe_subscription_id: subscriptionId,
                  ...(customerId ? { stripe_customer_id: customerId } : {}),
                })
              if (insertError) throw insertError
              selfHealed = true
            } catch (err) {
              console.error(
                'stripe-webhook: provision self-heal insert failed:',
                err instanceof Error ? err.message : err,
              )
            }
            await deps.alert({
              type: 'provision_missing',
              message: selfHealed
                ? `No provision row for request ${requestId}; inserted a minimal pending row carrying subscription ${subscriptionId}`
                : `No provision row for request ${requestId}; subscription ${subscriptionId} is live but untracked (self-heal insert failed)`,
              fields: { requestId, subscriptionId, selfHealed },
            })
          }
        }
      }

      // Idempotent: provisionIfNeeded claims its transition with a status guard,
      // so a re-delivered completed event does not double-activate.
      await provisionIfNeeded(adminClient, requestId, deps.connectorDeps ?? {})
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

  // A subscription changed standing WITHOUT a delete event. Whether Stripe deletes
  // a subscription after dunning or leaves it behind is a dashboard setting:
  // "cancel subscription" ends in customer.subscription.deleted (handled above),
  // but "mark subscription unpaid" leaves it as `unpaid`, and a cancel-without-
  // delete leaves it as `canceled` — neither fires a deleted event. We sync the
  // concierge to the subscription's standing here so access tracks payment no
  // matter how dunning is configured.
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription
    const adminClient = deps.createAdminClient()
    if (subscription.status === 'unpaid' || subscription.status === 'canceled') {
      // Terminal non-paying: switch the concierge off. We deliberately do NOT act
      // on `past_due` — Stripe is still retrying, so access stays through the
      // grace window. Idempotent, so a later deleted event is a safe no-op.
      await deactivateSubscription(adminClient, subscription.id)
    } else if (subscription.status === 'active' || subscription.status === 'trialing') {
      // Paid standing: extend entitlement to this period's end. This fires on
      // creation and on every renewal, so it is the ONLY place a concierge
      // becomes servable after setup — and the reason a lapse needs no event.
      await syncEntitlement(
        adminClient,
        subscription.id,
        (subscription as { current_period_end?: number }).current_period_end,
      )
      // Recovery: `unpaid` is NOT terminal — if the customer pays the past-due
      // invoice Stripe transitions unpaid -> active and fires this event. Without
      // a revive path the concierge would stay dark forever (nothing else ever
      // flips is_active back on). reactivateSubscription only revives a provision
      // WE cancelled, so an ordinary trialing/active update mid-provisioning is
      // never disturbed.
      await reactivateSubscription(adminClient, subscription.id)
    }
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

// How long past Stripe's current_period_end a concierge keeps serving.
//
// concierge-chat refuses to serve once entitled_until has passed (migration
// 20260729100000), so this value is the only thing standing between a delayed
// renewal webhook and a PAYING customer's bot going dark mid-conversation.
// Stripe extends current_period_end at renewal and keeps a dunning subscription
// active with a fresh period, so the only gap this covers is webhook lag —
// three days is generous for that, and a freeloader gaining three extra days is
// a far cheaper mistake than a paying coach losing three.
const ENTITLEMENT_GRACE_MS = 3 * 24 * 60 * 60 * 1000

// Resolve the concierge behind a subscription. Both entitlement and activation
// need it, and the only link is the provision's config.concierge_id (written by
// concierge-setup) — there is no FK column.
async function conciergeIdForSubscription(
  adminClient: SupabaseClient,
  subscriptionId: string,
): Promise<{ provisionId: string; conciergeId?: string } | null> {
  const { data: provision } = await adminClient
    .from('automation_provisions')
    .select('id, config')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle()
  if (!provision) return null
  const config = ((provision as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>
  const conciergeId = typeof config.concierge_id === 'string' ? config.concierge_id : undefined
  return { provisionId: (provision as { id: string }).id, conciergeId }
}

// Write how long this concierge is paid up until. Called on every subscription
// event that carries a period, so a renewal silently extends service and a
// lapse silently ends it — no separate "turn it off" event required. That is the
// point: is_active only ever recorded what the last webhook said, so a webhook
// that never arrived meant free service forever. A timestamp expires by itself.
export async function syncEntitlement(
  adminClient: SupabaseClient,
  subscriptionId: string,
  currentPeriodEnd: number | null | undefined,
): Promise<void> {
  if (typeof currentPeriodEnd !== 'number' || !Number.isFinite(currentPeriodEnd)) return
  const found = await conciergeIdForSubscription(adminClient, subscriptionId)
  if (!found?.conciergeId) return
  const entitledUntil = new Date(currentPeriodEnd * 1000 + ENTITLEMENT_GRACE_MS).toISOString()
  await adminClient
    .from('concierges')
    .update({ entitled_until: entitledUntil })
    .eq('id', found.conciergeId)
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
    // Clear entitlement alongside is_active. Without this a cancellation would
    // leave the concierge paid-up until the end of the period it had already
    // been granted, so it would keep answering — and the reactivate path below
    // could not tell "we cancelled this" from "still entitled".
    await adminClient
      .from('concierges')
      .update({ is_active: false, entitled_until: null })
      .eq('id', conciergeId)
  }

  await adminClient
    .from('automation_provisions')
    .update({ status: 'cancelled' })
    .eq('id', (provision as { id: string }).id)
}

// Reverse of deactivateSubscription: bring a concierge back after its subscription
// recovers to good standing (e.g. an `unpaid` invoice finally gets paid, which
// Stripe reports as unpaid -> active). Guarded to only revive a provision we
// previously marked 'cancelled', so it never touches an in-flight
// pending/provisioning row or an already-active one — a plain trialing/active
// update mid-onboarding is a no-op. Safe to call repeatedly.
async function reactivateSubscription(adminClient: SupabaseClient, subscriptionId: string): Promise<void> {
  const { data: provision } = await adminClient
    .from('automation_provisions')
    .select('id, status, config')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle()
  if (!provision) return
  if ((provision as { status?: string }).status !== 'cancelled') return

  const config = ((provision as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>
  const conciergeId = typeof config.concierge_id === 'string' ? config.concierge_id : undefined
  if (conciergeId) {
    await adminClient
      .from('concierges')
      .update({ is_active: true })
      .eq('id', conciergeId)
  }

  await adminClient
    .from('automation_provisions')
    .update({ status: 'active' })
    .eq('id', (provision as { id: string }).id)
}

if (import.meta.main) {
  Deno.serve((req) => handleStripeWebhook(req))
}
