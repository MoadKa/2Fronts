// Exchanges a customer's stored (encrypted) Google refresh token for a live
// access token, so configure()/run() can reach the Sheets API on their behalf.
//
// The refresh token is the crown jewel: it is decrypted only in memory here and
// the access token is returned to the caller, never persisted. When Google
// reports `invalid_grant` (the user revoked our access, or the token expired),
// we flip the connection to `status='revoked'` so the UI can prompt a reconnect
// instead of silently failing forever.
//
// fetch + getEnv + decryptToken are injected so tests run with no network and no
// real key, mirroring the deps style used across the edge functions.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { decryptToken } from './tokenCrypto.ts'

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const CONNECTOR_TYPE = 'google_sheets'

export interface GoogleAuthDeps {
  getEnv: (key: string) => string | undefined
  fetch: typeof fetch
  decryptToken: (ciphertext: string) => Promise<string>
}

const defaultDeps: GoogleAuthDeps = {
  getEnv: (key) => Deno.env.get(key),
  fetch: (input, init) => fetch(input, init),
  decryptToken,
}

interface ConnectionRow {
  encrypted_refresh_token: string | null
  status: string
}

interface GoogleTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

// Resolve a live Google access token for the customer's google_sheets
// connection. Throws on a missing connection, missing OAuth config, or a failed
// refresh (marking the connection revoked on invalid_grant).
export async function getAccessTokenForCustomer(
  adminClient: SupabaseClient,
  customerId: string,
  deps: GoogleAuthDeps = defaultDeps,
): Promise<string> {
  const { data, error } = await adminClient
    .from('connector_connections')
    .select('encrypted_refresh_token, status')
    .eq('customer_id', customerId)
    .eq('connector_type', CONNECTOR_TYPE)
    .maybeSingle()

  if (error || !data) throw new Error('no_connection')
  const row = data as ConnectionRow
  if (!row.encrypted_refresh_token) throw new Error('no_connection')

  const clientId = deps.getEnv('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = deps.getEnv('GOOGLE_OAUTH_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('google_oauth_not_configured')

  const refreshToken = await deps.decryptToken(row.encrypted_refresh_token)

  const res = await deps.fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  })

  const body = (await res.json().catch(() => ({}))) as GoogleTokenResponse
  if (!res.ok || !body.access_token) {
    if (body.error === 'invalid_grant') {
      // User revoked us (or the grant expired). Mark revoked so the UI can ask
      // them to reconnect rather than retrying a dead token on every lead.
      await adminClient
        .from('connector_connections')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('customer_id', customerId)
        .eq('connector_type', CONNECTOR_TYPE)
    }
    throw new Error(`token_refresh_failed: ${body.error ?? res.status}`)
  }

  return body.access_token
}

// Adapter matching the connector's getAccessToken dependency
// (`(ctx) => Promise<string>`). The customer is bound here, so the ctx the
// connector passes is ignored.
export function makeGetAccessToken(
  adminClient: SupabaseClient,
  customerId: string,
  deps: GoogleAuthDeps = defaultDeps,
): () => Promise<string> {
  return () => getAccessTokenForCustomer(adminClient, customerId, deps)
}
