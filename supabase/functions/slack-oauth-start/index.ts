// slack-oauth-start: builds the Slack OAuth v2 authorize URL and 302-redirects
// the customer to it. The `state` param carries the PROVISION id the customer is
// connecting for; the callback derives the owning customer from it and routes
// back to that provision's channel-picker screen.
//
// Mirrors google-oauth-start: an injectable env getter, and the SAME signed +
// browser-bound state (CSRF) via _shared/oauthState.ts. The cookie nonce the
// callback enforces stops a connect an attacker started from completing in a
// victim's browser.

import { signState, stateCookie } from '../_shared/oauthState.ts'
import { SLACK_OAUTH_SCOPES } from '../_shared/slackConnector.ts'
import { slackClientId } from '../_shared/slackEnv.ts'

const AUTH_ENDPOINT = 'https://slack.com/oauth/v2/authorize'

export interface SlackOAuthStartDeps {
  getEnv: (key: string) => string | undefined
}

const defaultDeps: SlackOAuthStartDeps = {
  getEnv: (key) => Deno.env.get(key),
}

export async function handleSlackOAuthStart(
  req: Request,
  deps: SlackOAuthStartDeps = defaultDeps,
): Promise<Response> {
  const clientId = slackClientId(deps.getEnv)
  const redirectUri = deps.getEnv('SLACK_OAUTH_REDIRECT_URI')
  const stateSecret = deps.getEnv('OAUTH_STATE_SECRET')

  if (!clientId || !redirectUri || !stateSecret) {
    return new Response('Slack OAuth is not configured', { status: 500 })
  }

  const url = new URL(req.url)
  const provisionId = url.searchParams.get('state') ?? url.searchParams.get('provision_id') ?? ''
  if (!provisionId) {
    return new Response('Missing provision id', { status: 400 })
  }

  const { state, nonce } = await signState(provisionId, stateSecret)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    // OAuth v2 bot scopes go in `scope`.
    scope: SLACK_OAUTH_SCOPES.join(','),
    state,
  })

  const consentUrl = `${AUTH_ENDPOINT}?${params.toString()}`

  return new Response(null, {
    status: 302,
    headers: { Location: consentUrl, 'Set-Cookie': stateCookie(nonce) },
  })
}

if (import.meta.main) {
  Deno.serve((req) => handleSlackOAuthStart(req))
}
