import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { Connector, ConnectorDeps, ProvisionRow } from './connectors.ts'

// The result of a connector's one-time provision step.
export type AttemptProvisionResult = 'active' | 'failed' | 'not-claimed'

// Claim the provision row, run the connector, persist the outcome.
//
// This used to be `attemptProvision`, which was Twilio-specific: it claimed the
// row, bought a phone number, and wrote the resulting status. When the SMS
// product was removed (2026-08-07) the number purchase went away and the claim
// and the status write went with it, which silently cost two properties every
// connector still needs:
//
//   * Idempotency. A redelivered Stripe webhook or two admins hitting Retry at
//     once must not both run fulfillment. The claim is a status-guarded UPDATE:
//     only the caller whose UPDATE matches a row proceeds, everyone else gets
//     'not-claimed' and stops.
//   * Persistence. Connectors RETURN their result; nothing wrote it. Without
//     this, a successful retry answered 'active' while the row stayed 'failed'.
//
// Both live here now, connector-agnostic, so every connector inherits them.
export async function runConnectorProvision(
  adminClient: SupabaseClient,
  connector: Connector,
  row: ProvisionRow,
  fromStatus: string,
  deps: ConnectorDeps = {},
): Promise<AttemptProvisionResult> {
  const { data: claimed, error: claimError } = await adminClient
    .from('automation_provisions')
    .update({ status: 'provisioning' })
    .eq('status', fromStatus)
    .eq('id', row.id)
    .select()
    .maybeSingle()

  // A transient DB error and "somebody else holds the claim" both surface as a
  // null row. Telling them apart matters: the second is normal and must stay
  // silent, the first would otherwise leave a PAID provision stuck at its old
  // status with nobody alerted and no retry.
  if (claimError) {
    console.error(
      `runConnectorProvision: claim failed for provision ${row.id}:`,
      claimError.message ?? claimError,
    )
    return 'failed'
  }
  if (!claimed) return 'not-claimed'

  let result: AttemptProvisionResult
  try {
    result = await connector.provision({ adminClient, row, fromStatus, deps })
  } catch (error) {
    console.error(
      `runConnectorProvision: connector ${connector.connectorType} threw for provision ${row.id}:`,
      error instanceof Error ? error.message : error,
    )
    result = 'failed'
  }

  // 'not-claimed' from the connector itself would be a lie at this point: we
  // already hold the claim. Treat anything that is not 'active' as failed.
  const finalStatus = result === 'active' ? 'active' : 'failed'

  // Guarded on 'provisioning', not just the id. Without the guard this write
  // clobbers whatever landed while the connector ran: a customer.subscription
  // .deleted arriving mid-provision sets the row 'cancelled', and an unguarded
  // write here would resurrect it as 'active' while its concierge is switched
  // off.
  const { data: persisted, error: persistError } = await adminClient
    .from('automation_provisions')
    .update({ status: finalStatus })
    .eq('id', row.id)
    .eq('status', 'provisioning')
    .select()
    .maybeSingle()

  if (persistError) {
    console.error(
      `runConnectorProvision: could not persist ${finalStatus} for provision ${row.id}:`,
      persistError.message ?? persistError,
    )
    return 'failed'
  }
  if (!persisted) {
    // Someone moved the row out of 'provisioning' while we worked. Their write
    // wins; report what we did without pretending it stuck.
    console.warn(
      `runConnectorProvision: provision ${row.id} moved out of 'provisioning' during fulfillment; not overwriting`,
    )
    return 'not-claimed'
  }

  return finalStatus
}
