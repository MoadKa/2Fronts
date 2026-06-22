// google-oauth-start: builds the Google OAuth consent URL and 302-redirects the
// customer to it. The `state` param carries the PROVISION id the customer is
// connecting for; the callback derives the owning customer from it and routes
// back to that provision's mapping screen. access_type=offline +
// prompt=consent are required to reliably receive a refresh token.
//
// Factored as handleOAuthStart(req, deps) with an injectable env getter so the
// test can drive it with a fake env, mirroring stripe-webhook's deps style.
//
// CSRF: the `state` is now signed and bound to a per-flow nonce that we also set
// as an HttpOnly cookie. The callback requires the cookie nonce to match the
// state nonce, so a connect an attacker started can't be completed in a victim's
// browser. See _shared/oauthState.ts.

import { signState, stateCookie } from '../_shared/oauthState.ts'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
]

export interface OAuthStartDeps {
  getEnv: (key: string) => string | undefined
}

const defaultDeps: OAuthStartDeps = {
  getEnv: (key) => Deno.env.get(key),
}

export async function handleOAuthStart(req: Request, deps: OAuthStartDeps = defaultDeps): Promise<Response> {
  const clientId = deps.getEnv('GOOGLE_OAUTH_CLIENT_ID')
  const redirectUri = deps.getEnv('GOOGLE_OAUTH_REDIRECT_URI')
  const stateSecret = deps.getEnv('OAUTH_STATE_SECRET')

  if (!clientId || !redirectUri || !stateSecret) {
    return new Response('Google OAuth is not configured', { status: 500 })
  }

  // The provision id the customer is connecting for. Accept it from the query
  // string (state or provision_id).
  const url = new URL(req.url)
  const provisionId = url.searchParams.get('state') ?? url.searchParams.get('provision_id') ?? ''
  if (!provisionId) {
    return new Response('Missing provision id', { status: 400 })
  }

  // Sign the provision id into the state and bind it to a nonce we set as a
  // cookie. The callback enforces cookie-nonce == state-nonce (CSRF).
  const { state, nonce } = await signState(provisionId, stateSecret)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })

  const consentUrl = `${AUTH_ENDPOINT}?${params.toString()}`

  return new Response(null, {
    status: 302,
    headers: { Location: consentUrl, 'Set-Cookie': stateCookie(nonce) },
  })
}

if (import.meta.main) {
  Deno.serve((req) => handleOAuthStart(req))
}
