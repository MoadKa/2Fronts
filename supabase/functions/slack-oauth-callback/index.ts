// slack-oauth-callback: receives Slack's redirect (?code=...&state=...),
// exchanges the code for an OAuth v2 token response, ENCRYPTS the bot token, and
// upserts a connector_connections row via the service-role admin client.
//
// `state` carries the PROVISION the customer is connecting for. We derive the
// owning customer from that provision server-side (never trusting a raw customer
// id) and, on success, redirect to that provision's channel-picker screen.
//
// Mirrors google-oauth-callback: injected fetch (offline tests), the shared
// signed/browser-bound state check, and the same encrypt-before-persist posture.
// Slack's bot token is stored in the SAME encrypted_refresh_token column the
// Google connector uses (it is the long-lived credential for this connection).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { encryptToken } from '../_shared/tokenCrypto.ts'
import { resolveAppBaseUrl } from '../_shared/appUrl.ts'
import { OAUTH_STATE_COOKIE, readCookie, verifyState } from '../_shared/oauthState.ts'
import { SLACK_CONNECTOR_TYPE } from '../_shared/slackConnector.ts'
import { slackClientId, slackClientSecret } from '../_shared/slackEnv.ts'

const TOKEN_ENDPOINT = 'https://slack.com/api/oauth.v2.access'

interface SlackOAuthV2Response {
  ok?: boolean
  error?: string
  // Bot token (xoxb-...) lives at the top level in OAuth v2.
  access_token?: string
  token_type?: string
  scope?: string
  team?: { id?: string; name?: string }
}

export interface SlackOAuthCallbackDeps {
  getEnv: (key: string) => string | undefined
  fetch: typeof fetch
  createAdminClient: () => SupabaseClient
  encryptToken: (plaintext: string) => Promise<string>
}

const defaultDeps: SlackOAuthCallbackDeps = {
  getEnv: (key) => Deno.env.get(key),
  fetch: (input, init) => fetch(input, init),
  createAdminClient,
  encryptToken,
}

function errorRedirect(appBaseUrl: string | null, reason: string): Response {
  if (!appBaseUrl) {
    return new Response(`OAuth connection failed: ${reason}`, { status: 400 })
  }
  const location = `${appBaseUrl}/connections/result?status=error`
  return new Response(null, { status: 302, headers: { Location: location } })
}

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
  const rel = (data as { automation_requests?: unknown }).automation_requests
  const row = (Array.isArray(rel) ? rel[0] : rel) as { customer_id?: unknown } | undefined
  return typeof row?.customer_id === 'string' ? row.customer_id : null
}

export async function handleSlackOAuthCallback(
  req: Request,
  deps: SlackOAuthCallbackDeps = defaultDeps,
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
    console.error('slack-oauth-callback:', err instanceof Error ? err.message : err)
  }

  if (oauthError) {
    return errorRedirect(appBaseUrl, 'consent_denied')
  }

  if (!code || !state) {
    return errorRedirect(appBaseUrl, 'missing_code_or_state')
  }

  // CSRF: the signed state must verify against the per-flow nonce cookie that
  // slack-oauth-start set in THIS browser. (Same guard as the Google flow.)
  const stateSecret = deps.getEnv('OAUTH_STATE_SECRET')
  const cookieNonce = readCookie(req.headers.get('Cookie'), OAUTH_STATE_COOKIE)
  const provisionId = stateSecret ? await verifyState(state, cookieNonce, stateSecret) : null
  if (!provisionId) {
    return errorRedirect(appBaseUrl, 'invalid_state')
  }

  const clientId = slackClientId(deps.getEnv)
  const clientSecret = slackClientSecret(deps.getEnv)
  const redirectUri = deps.getEnv('SLACK_OAUTH_REDIRECT_URI')
  if (!clientId || !clientSecret || !redirectUri) {
    return errorRedirect(appBaseUrl, 'not_configured')
  }

  // 1. Exchange the authorization code for tokens (OAuth v2).
  const tokenRes = await deps.fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  })

  const tokens = (await tokenRes.json().catch(() => ({}))) as SlackOAuthV2Response
  if (!tokenRes.ok || !tokens.ok || !tokens.access_token) {
    return errorRedirect(appBaseUrl, `token_exchange_failed: ${tokens.error ?? tokenRes.status}`)
  }

  // 2. Encrypt the bot token BEFORE it touches the database.
  const encryptedBotToken = await deps.encryptToken(tokens.access_token)

  // 3. Resolve which customer owns the provision (from the verified state).
  const adminClient = deps.createAdminClient()
  const customerId = await resolveCustomerId(adminClient, provisionId)
  if (!customerId) {
    return errorRedirect(appBaseUrl, 'unknown_provision')
  }

  // 4. Upsert the connection (service-role, bypasses RLS). Unique on
  //    (customer_id, connector_type), so re-connecting refreshes in place.
  const { error } = await adminClient.from('connector_connections').upsert(
    {
      customer_id: customerId,
      connector_type: SLACK_CONNECTOR_TYPE,
      encrypted_refresh_token: encryptedBotToken,
      scope: tokens.scope ?? '',
      external_account_email: tokens.team?.name ?? null,
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
  // 5. Send the customer straight to the channel-picker confirmation.
  const location = `${appBaseUrl}/connect/${provisionId}/confirm`
  return new Response(null, { status: 302, headers: { Location: location } })
}

if (import.meta.main) {
  Deno.serve((req) => handleSlackOAuthCallback(req))
}
