import { assertEquals } from 'jsr:@std/assert@1'
import { slackClientId, slackClientSecret, slackSigningSecret } from './slackEnv.ts'

const ENV: Record<string, string> = {
  SLACK_CLIENT_ID: 'cid',
  SLACK_CLIENT_SECRET: 'csecret',
  SLACK_SIGNING_SECRET: 'ssecret',
}
const getEnv = (k: string) => ENV[k]

Deno.test('slack env getters read each secret from the injected env', () => {
  assertEquals(slackClientId(getEnv), 'cid')
  assertEquals(slackClientSecret(getEnv), 'csecret')
  assertEquals(slackSigningSecret(getEnv), 'ssecret')
})

Deno.test('slack env getters return undefined when unset (never a hardcoded value)', () => {
  const empty = () => undefined
  assertEquals(slackClientId(empty), undefined)
  assertEquals(slackClientSecret(empty), undefined)
  assertEquals(slackSigningSecret(empty), undefined)
})
