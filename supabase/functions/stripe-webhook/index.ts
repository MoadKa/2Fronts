import Stripe from 'npm:stripe@16'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { purchaseNumber } from '../_shared/twilioProvision.ts'
import { type ProvisionAutomation } from '../_shared/provisioning.ts'
import { getConnector, type ProvisionRow } from '../_shared/connectors.ts'

export type { ProvisionAutomation }

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

interface WebhookDeps {
  stripe: Pick<Stripe, 'webhooks'>
  createAdminClient: () => SupabaseClient
  provisionAutomation: ProvisionAutomation
}

const defaultDeps: WebhookDeps = {
  stripe,
  createAdminClient,
  provisionAutomation: { purchaseNumber },
}

async function provisionIfNeeded(
  adminClient: SupabaseClient,
  requestId: string,
  provisionAutomation: ProvisionAutomation
): Promise<void> {
  const { data: requestRow } = await adminClient
    .from('automation_requests')
    .select('automations(requires_provisioning)')
    .eq('id', requestId)
    .single()

  const automation = (requestRow as { automations: { requires_provisioning: boolean } } | null)?.automations
  if (!automation?.requires_provisioning) return

  const { data: provisionRow } = await adminClient
    .from('automation_provisions')
    .select('id, connector_type, business_name, booking_link, config, status')
    .eq('request_id', requestId)
    .single()
  if (!provisionRow) return

  // Dispatch by connector_type. Legacy/Twilio rows (connector_type null or
  // 'twilio_missed_call') route to the missed-call connector, which reuses the
  // existing claim-first attemptProvision engine via the provisionAutomation dep.
  const row = provisionRow as ProvisionRow
  const connector = getConnector(row.connector_type)
  await connector.provision({ adminClient, row, fromStatus: 'pending', deps: { provisionAutomation } })
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

      await provisionIfNeeded(adminClient, requestId, deps.provisionAutomation)
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
}

if (import.meta.main) {
  Deno.serve((req) => handleStripeWebhook(req))
}
