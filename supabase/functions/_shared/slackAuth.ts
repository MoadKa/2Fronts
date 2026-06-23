// Resolves a customer's stored (encrypted) Slack bot token so configure()/run()
// can reach the Slack Web API on their behalf.
//
// Unlike Google, Slack bot tokens (xoxb-...) do not expire and there is no
// refresh exchange: OAuth v2 returns a long-lived bot token we encrypt at rest
// (reusing the same connector_connections.encrypted_refresh_token column + the
// shared tokenCrypto key). Here we just decrypt and return it.
//
// decryptToken is injected so tests run with no real key, mirroring googleAuth.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { decryptToken } from './tokenCrypto.ts'
import { SLACK_CONNECTOR_TYPE } from './slackConnector.ts'

export interface SlackAuthDeps {
  decryptToken: (ciphertext: string) => Promise<string>
}

const defaultDeps: SlackAuthDeps = {
  decryptToken,
}

interface ConnectionRow {
  encrypted_refresh_token: string | null
  status: string
}

// Resolve the live Slack bot token for the customer's slack_notifications
// connection. Throws on a missing connection (so the connector surfaces a clear
// failure rather than posting nowhere).
export async function getSlackTokenForCustomer(
  adminClient: SupabaseClient,
  customerId: string,
  deps: SlackAuthDeps = defaultDeps,
): Promise<string> {
  const { data, error } = await adminClient
    .from('connector_connections')
    .select('encrypted_refresh_token, status')
    .eq('customer_id', customerId)
    .eq('connector_type', SLACK_CONNECTOR_TYPE)
    .maybeSingle()

  if (error || !data) throw new Error('no_connection')
  const row = data as ConnectionRow
  if (!row.encrypted_refresh_token) throw new Error('no_connection')

  return await deps.decryptToken(row.encrypted_refresh_token)
}
