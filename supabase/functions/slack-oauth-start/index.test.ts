import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { handleSlackOAuthStart } from './index.ts'
import { OAUTH_STATE_COOKIE } from '../_shared/oauthState.ts'

const ENV: Record<string, string> = {
  SLACK_CLIENT_ID: 'fake-client-id',
  SLACK_OAUTH_REDIRECT_URI: 'https://app.example.com/functions/v1/slack-oauth-callback',
  OAUTH_STATE_SECRET: 'test-oauth-state-secret',
}

const deps = { getEnv: (k: string) => ENV[k] }

Deno.test('slack start 302-redirects to Slack authorize with the right scopes + a state cookie', async () => {
  const req = new Request('http://localhost/slack-oauth-start?provision_id=prov-1')
  const res = await handleSlackOAuthStart(req, deps)

  assertEquals(res.status, 302)
  const loc = res.headers.get('Location') ?? ''
  assertStringIncludes(loc, 'https://slack.com/oauth/v2/authorize')
  assertStringIncludes(loc, 'client_id=fake-client-id')
  // OAuth v2 bot scopes, comma-joined (URL-encoded comma is %2C).
  assertStringIncludes(loc, 'scope=chat%3Awrite%2Cchannels%3Aread')
  // CSRF: a browser-bound nonce cookie is set.
  assertStringIncludes(res.headers.get('Set-Cookie') ?? '', `${OAUTH_STATE_COOKIE}=`)
})

Deno.test('slack start accepts the provision id via the state param too', async () => {
  const req = new Request('http://localhost/slack-oauth-start?state=prov-9')
  const res = await handleSlackOAuthStart(req, deps)
  assertEquals(res.status, 302)
  // The outgoing state is signed (contains the provision id + a nonce + sig).
  assertStringIncludes(res.headers.get('Location') ?? '', 'state=prov-9.')
})

Deno.test('slack start errors when not configured', async () => {
  const res = await handleSlackOAuthStart(
    new Request('http://localhost/slack-oauth-start?provision_id=p1'),
    { getEnv: () => undefined },
  )
  assertEquals(res.status, 500)
})

Deno.test('slack start 400s without a provision id', async () => {
  const res = await handleSlackOAuthStart(new Request('http://localhost/slack-oauth-start'), deps)
  assertEquals(res.status, 400)
})
