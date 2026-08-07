import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getConnector, type ConnectorDeps, type ProvisionRow } from './connectors.ts'
import { runConnectorProvision } from './provisioning.ts'

// Shared post-payment fulfillment: dispatch a request's provision to its
// connector. Used by BOTH the stripe-webhook (on a paid Stripe session) and
// create-checkout-session (on a free, 0-amount automation that skips Stripe),
// so the two paths fulfill identically.
//
// deps is forwarded verbatim to the connector; each one reads only what it
// needs (google_sheets wants getAccessToken, slack wants slackFetcher). It used
// to carry the Twilio number purchaser, which went away with the SMS product.
export async function provisionIfNeeded(
  adminClient: SupabaseClient,
  requestId: string,
  deps: ConnectorDeps = {},
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

  // Dispatch by connector_type. Rows carrying a retired type (or no type at
  // all, which used to mean Twilio) make getConnector throw a named error.
  //
  // That throw must NOT escape: the only callers are the Stripe webhook and
  // create-checkout-session, and a non-2xx there makes Stripe redeliver the
  // event forever. An unprovisionable row is terminal, not transient, so mark
  // it failed and return normally. The admin request list already surfaces
  // 'failed' and offers Retry, which answers 409 for the same reason.
  const row = provisionRow as ProvisionRow
  let connector
  try {
    connector = getConnector(row.connector_type)
  } catch (error) {
    console.error(
      `provisionIfNeeded: provision ${row.id} cannot be fulfilled:`,
      (error as Error).message,
    )
    // Guarded on the status we read, for the same reason runConnectorProvision
    // guards its outcome write: a concurrent cancellation (or the delisting
    // migration) may already have moved this row to a terminal state, and
    // pulling it back to 'failed' would put a Retry button in front of an admin
    // that can only ever 409.
    await adminClient
      .from('automation_provisions')
      .update({ status: 'failed' })
      .eq('id', row.id)
      .in('status', ['pending', 'provisioning'])
    return
  }

  // Claims the row before dispatching, so a redelivered Stripe event does not
  // re-run fulfillment, and writes the outcome back.
  await runConnectorProvision(adminClient, connector, row, 'pending', deps)
}
