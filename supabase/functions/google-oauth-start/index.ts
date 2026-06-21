// google-oauth-start: builds the Google OAuth consent URL and 302-redirects the
// customer to it. The `state` param carries the provision/customer id so the
// callback can attribute the resulting tokens. access_type=offline +
// prompt=consent are required to reliably receive a refresh token.
//
// Factored as handleOAuthStart(req, deps) with an injectable env getter so the
// test can drive it with a fake env, mirroring stripe-webhook's deps style.

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

export function handleOAuthStart(req: Request, deps: OAuthStartDeps = defaultDeps): Response {
  const clientId = deps.getEnv('GOOGLE_OAUTH_CLIENT_ID')
  const redirectUri = deps.getEnv('GOOGLE_OAUTH_REDIRECT_URI')

  if (!clientId || !redirectUri) {
    return new Response('Google OAuth is not configured', { status: 500 })
  }

  // Carry the provision/customer id through the consent flow. Accept it from the
  // query string; fall back to empty string so the callback can detect a
  // misconfigured link rather than silently dropping it.
  const url = new URL(req.url)
  const state = url.searchParams.get('state') ?? url.searchParams.get('provision_id') ?? ''

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

  return new Response(null, { status: 302, headers: { Location: consentUrl } })
}

if (import.meta.main) {
  Deno.serve((req) => handleOAuthStart(req))
}
