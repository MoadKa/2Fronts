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
  // Read the connector_type from the AUTOMATION, not from the provision.
  //
  // automation_provisions.connector_type carried a DB default of
  // 'twilio_missed_call' until 20260807160000 dropped it, and 20260623000001
  // backfilled only automations.connector_type. So a provision row born from
  // that default is mislabeled twilio while actually being a google_sheets or
  // booking_concierge purchase. Migration 20260807160000 was rewritten to scope
  // through this same join for exactly that reason; dispatching on the provision
  // column here would charge a Booking Concierge customer and then mark their
  // provision permanently unfulfillable.
  const { data: requestRow, error: requestError } = await adminClient
    .from('automation_requests')
    .select('automations(requires_provisioning, connector_type)')
    .eq('id', requestId)
    .single()

  if (requestError) {
    // Do NOT treat a transient lookup failure as "no work to do". Swallowing it
    // means the webhook answers 200, Stripe never redelivers, and a paid request
    // silently never provisions with no failed status and no trace.
    console.error(
      `provisionIfNeeded: could not read request ${requestId}:`,
      requestError.message ?? requestError,
    )
    throw requestError
  }

  const embedded = (requestRow as { automations?: unknown } | null)?.automations
  const automation = (Array.isArray(embedded) ? embedded[0] : embedded) as
    | { requires_provisioning?: boolean; connector_type?: string | null }
    | null
  if (!automation?.requires_provisioning) return

  const { data: provisionRow, error: provisionError } = await adminClient
    .from('automation_provisions')
    .select('id, connector_type, config, status')
    .eq('request_id', requestId)
    .single()

  if (provisionError && provisionError.code !== 'PGRST116') {
    // PGRST116 is "no rows" from .single(), which is a legitimate state the
    // webhook's self-heal handles. Anything else is a real failure.
    console.error(
      `provisionIfNeeded: could not read provision for request ${requestId}:`,
      provisionError.message ?? provisionError,
    )
    throw provisionError
  }
  if (!provisionRow) return

  const row = provisionRow as ProvisionRow
  // The automation is the source of truth; the provision column is only a
  // fallback for rows whose automation somehow carries none (not possible today,
  // both columns are NOT NULL).
  const connectorType = automation.connector_type ?? row.connector_type

  let connector
  try {
    connector = getConnector(connectorType)
  } catch (error) {
    // A retired or unknown connector is TERMINAL, not transient. The throw must
    // not escape: the callers are the Stripe webhook and create-checkout-session,
    // and a non-2xx there makes Stripe redeliver the event forever.
    console.error(
      `provisionIfNeeded: provision ${row.id} cannot be fulfilled:`,
      (error as Error).message,
    )
    // Guarded on 'pending' ONLY, matching the claim runConnectorProvision would
    // have taken. A broader guard would also catch 'provisioning', which is
    // where concierge-setup parks every live concierge (concierge-setup:112) —
    // a redelivered event would then flip a working, paid, serving concierge to
    // 'failed'.
    await adminClient
      .from('automation_provisions')
      .update({ status: 'failed' })
      .eq('id', row.id)
      .eq('status', 'pending')
    return
  }

  // Claims the row before dispatching, so a redelivered Stripe event does not
  // re-run fulfillment, and writes the outcome back.
  await runConnectorProvision(adminClient, connector, { ...row, connector_type: connectorType }, 'pending', deps)
}
