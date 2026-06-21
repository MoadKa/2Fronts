// google-oauth-callback: receives Google's redirect (?code=...&state=...),
// exchanges the code for tokens, reads the user's email, ENCRYPTS the refresh
// token, and upserts a connector_connections row via the service-role admin
// client. On success the customer is redirected back into the app.
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

  // 4. Upsert the connection (service-role, bypasses RLS). Unique on
  //    (customer_id, connector_type), so re-connecting refreshes in place.
  const adminClient = deps.createAdminClient()
  const { error } = await adminClient.from('connector_connections').upsert(
    {
      customer_id: state,
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
  const location = `${appBaseUrl}/connections/result?status=success&connector=google_sheets`
  return new Response(null, { status: 302, headers: { Location: location } })
}

if (import.meta.main) {
  Deno.serve((req) => handleOAuthCallback(req))
}
