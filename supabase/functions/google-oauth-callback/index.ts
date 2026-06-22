// google-oauth-callback: receives Google's redirect (?code=...&state=...),
// exchanges the code for tokens, reads the user's email, ENCRYPTS the refresh
// token, and upserts a connector_connections row via the service-role admin
// client.
//
// `state` carries the PROVISION the customer is connecting for. We derive the
// owning customer from that provision server-side (never trusting a raw
// customer id from the query string) and, on success, redirect the customer to
// that provision's column-mapping confirmation screen.
//
// fetch is injected so tests can mock Google's token + userinfo endpoints with
// canned responses — no real network calls. Deps style mirrors stripe-webhook.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { encryptToken } from '../_shared/tokenCrypto.ts'
import { resolveAppBaseUrl } from '../_shared/appUrl.ts'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo'

interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  scope?: string
  token_type?: string
  expires_in?: number
}

interface GoogleUserInfo {
  email?: string
}

export interface OAuthCallbackDeps {
  getEnv: (key: string) => string | undefined
  fetch: typeof fetch
  createAdminClient: () => SupabaseClient
  encryptToken: (plaintext: string) => Promise<string>
}

const defaultDeps: OAuthCallbackDeps = {
  getEnv: (key) => Deno.env.get(key),
  fetch: (input, init) => fetch(input, init),
  createAdminClient,
  encryptToken,
}

function errorRedirect(appBaseUrl: string | null, reason: string): Response {
  // If we couldn't resolve an app URL, fall back to a plain 400.
  if (!appBaseUrl) {
    return new Response(`OAuth connection failed: ${reason}`, { status: 400 })
  }
  const location = `${appBaseUrl}/connections/result?status=error`
  return new Response(null, { status: 302, headers: { Location: location } })
}

// Resolve the customer who owns a provision. The provision links to a request,
// which carries the customer_id. Returns null when the provision can't be found
// (a stale/forged state), so the caller can fail closed rather than write a
// connection against a guessed or attacker-supplied id.
async function resolveCustomerId(
  adminClient: SupabaseClient,
  provisionId: string,
): Promise<string | null> {
  const { data, error } = await adminClient
    .from('automation_provisions')
    .select('request_id, automation_requests(customer_id)')
    .eq('id', provisionId)
    .maybeSingle()
  if (error || !data) return null
  // A to-one embed comes back as an object, but tolerate an array shape too.
  const rel = (data as { automation_requests?: unknown }).automation_requests
  const row = (Array.isArray(rel) ? rel[0] : rel) as { customer_id?: unknown } | undefined
  return typeof row?.customer_id === 'string' ? row.customer_id : null
}

export async function handleOAuthCallback(
  req: Request,
  deps: OAuthCallbackDeps = defaultDeps,
): Promise<Response> {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') ?? ''
  const oauthError = url.searchParams.get('error')

  let appBaseUrl: string | null = null
  try {
    appBaseUrl = resolveAppBaseUrl(
      deps.getEnv('PUBLIC_APP_URL'),
      deps.getEnv('ALLOW_INSECURE_APP_URL') === 'true',
    )
  } catch (err) {
    console.error('google-oauth-callback:', err instanceof Error ? err.message : err)
  }

  // The user denied consent, or Google sent an error back.
  if (oauthError) {
    return errorRedirect(appBaseUrl, 'consent_denied')
  }

  if (!code || !state) {
    return errorRedirect(appBaseUrl, 'missing_code_or_state')
  }

  const clientId = deps.getEnv('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = deps.getEnv('GOOGLE_OAUTH_CLIENT_SECRET')
  const redirectUri = deps.getEnv('GOOGLE_OAUTH_REDIRECT_URI')
  if (!clientId || !clientSecret || !redirectUri) {
    return errorRedirect(appBaseUrl, 'not_configured')
  }

  // 1. Exchange the authorization code for tokens.
  const tokenRes = await deps.fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  })

  if (!tokenRes.ok) {
    return errorRedirect(appBaseUrl, 'token_exchange_failed')
  }

  const tokens = (await tokenRes.json()) as GoogleTokenResponse
  if (!tokens.refresh_token) {
    // No refresh token usually means the user previously consented; the start
    // handler forces prompt=consent to avoid this, but guard anyway.
    return errorRedirect(appBaseUrl, 'no_refresh_token')
  }

  // 2. Read the user's email so we can show which account they connected.
  let email: string | undefined
  if (tokens.access_token) {
    const userinfoRes = await deps.fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (userinfoRes.ok) {
      const info = (await userinfoRes.json()) as GoogleUserInfo
      email = info.email
    }
  }

  // 3. Encrypt the refresh token BEFORE it touches the database.
  const encryptedRefreshToken = await deps.encryptToken(tokens.refresh_token)

  // 4. Resolve which customer owns the provision named in `state`. We trust the
  //    database, not the query string: if the provision is unknown, fail closed.
  const provisionId = state
  const adminClient = deps.createAdminClient()
  const customerId = await resolveCustomerId(adminClient, provisionId)
  if (!customerId) {
    return errorRedirect(appBaseUrl, 'unknown_provision')
  }

  // 5. Upsert the connection (service-role, bypasses RLS). Unique on
  //    (customer_id, connector_type), so re-connecting refreshes in place.
  const { error } = await adminClient.from('connector_connections').upsert(
    {
      customer_id: customerId,
      connector_type: 'google_sheets',
      encrypted_refresh_token: encryptedRefreshToken,
      scope: tokens.scope ?? '',
      external_account_email: email ?? null,
      status: 'active',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'customer_id,connector_type' },
  )

  if (error) {
    return errorRedirect(appBaseUrl, 'persist_failed')
  }

  if (!appBaseUrl) {
    return new Response('Connected. You can close this window.', { status: 200 })
  }
  // 6. Send the customer straight to the column-mapping confirmation for the
  //    provision they just connected.
  const location = `${appBaseUrl}/connect/${provisionId}/confirm`
  return new Response(null, { status: 302, headers: { Location: location } })
}

if (import.meta.main) {
  Deno.serve((req) => handleOAuthCallback(req))
}
