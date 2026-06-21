import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { GOOGLE_OAUTH_SCOPES, handleOAuthStart, type OAuthStartDeps } from './index.ts'

function fakeEnv(values: Record<string, string>): OAuthStartDeps {
  return { getEnv: (key) => values[key] }
}

const CONFIGURED = fakeEnv({
  GOOGLE_OAUTH_CLIENT_ID: 'fake-client-id.apps.googleusercontent.com',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://app.example.com/functions/v1/google-oauth-callback',
})

Deno.test('302-redirects to Google consent with scopes, client_id and state', () => {
  const req = new Request('http://localhost/google-oauth-start?state=prov-123')
  const res = handleOAuthStart(req, CONFIGURED)

  assertEquals(res.status, 302)
  const location = res.headers.get('Location') ?? ''
  assertStringIncludes(location, 'https://accounts.google.com/o/oauth2/v2/auth')

  const parsed = new URL(location)
  assertEquals(parsed.searchParams.get('client_id'), 'fake-client-id.apps.googleusercontent.com')
  assertEquals(parsed.searchParams.get('state'), 'prov-123')
  assertEquals(parsed.searchParams.get('access_type'), 'offline')
  assertEquals(parsed.searchParams.get('prompt'), 'consent')
  assertEquals(parsed.searchParams.get('response_type'), 'code')
  assertEquals(
    parsed.searchParams.get('redirect_uri'),
    'https://app.example.com/functions/v1/google-oauth-callback',
  )

  const scope = parsed.searchParams.get('scope') ?? ''
  for (const expected of GOOGLE_OAUTH_SCOPES) {
    assertStringIncludes(scope, expected)
  }
})

Deno.test('accepts the carried id from provision_id when state is absent', () => {
  const req = new Request('http://localhost/google-oauth-start?provision_id=prov-456')
  const res = handleOAuthStart(req, CONFIGURED)

  const location = new URL(res.headers.get('Location') ?? '')
  assertEquals(location.searchParams.get('state'), 'prov-456')
})

Deno.test('returns 500 when Google OAuth env is not configured', () => {
  const req = new Request('http://localhost/google-oauth-start?state=prov-123')
  const res = handleOAuthStart(req, fakeEnv({}))

  assertEquals(res.status, 500)
})
