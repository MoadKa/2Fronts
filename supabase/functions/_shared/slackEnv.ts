// Central env getters for the Slack connector's secrets. Keeping them in one
// place documents exactly which secrets the Slack lane needs and ensures none is
// ever hardcoded — every value is read from Deno.env at call time.
//
// Secrets (set via `supabase secrets set`):
//   SLACK_CLIENT_ID       -- OAuth v2 app client id (slack-oauth-start/callback)
//   SLACK_CLIENT_SECRET   -- OAuth v2 app client secret (slack-oauth-callback)
//   SLACK_SIGNING_SECRET  -- verifies inbound Slack request signatures; reserved
//                            for a future inbound handler (events / slash
//                            commands). Surfaced here so the secret has a single
//                            named accessor and is never read ad hoc.
//
// getEnv is injectable so callers/tests can supply a fake env, mirroring the
// deps style used across the edge functions.

export type EnvGetter = (key: string) => string | undefined

const defaultGetEnv: EnvGetter = (key) => Deno.env.get(key)

export function slackClientId(getEnv: EnvGetter = defaultGetEnv): string | undefined {
  return getEnv('SLACK_CLIENT_ID')
}

export function slackClientSecret(getEnv: EnvGetter = defaultGetEnv): string | undefined {
  return getEnv('SLACK_CLIENT_SECRET')
}

// Reserved for verifying inbound Slack request signatures (no inbound handler
// yet). Exposed so the signing secret is referenced through one accessor.
export function slackSigningSecret(getEnv: EnvGetter = defaultGetEnv): string | undefined {
  return getEnv('SLACK_SIGNING_SECRET')
}
