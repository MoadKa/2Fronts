import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { purchaseNumber } from './twilioProvision.ts'
import { type ProvisionAutomation } from './provisioning.ts'
import { getConnector, type ProvisionRow } from './connectors.ts'

// Shared post-payment fulfillment: dispatch a request's provision to its
// connector. Used by BOTH the stripe-webhook (on a paid Stripe session) and
// create-checkout-session (on a free, 0-amount automation that skips Stripe),
// so the two paths fulfill identically.
export async function provisionIfNeeded(
  adminClient: SupabaseClient,
  requestId: string,
  provisionAutomation: ProvisionAutomation = { purchaseNumber },
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
