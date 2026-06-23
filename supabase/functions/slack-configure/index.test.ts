import { assertEquals } from 'jsr:@std/assert@1'
import { handleSlackConfigure, type SlackConfigureDeps } from './index.ts'
import type { SlackFetcher } from '../_shared/slackConnector.ts'

// Admin client serving the provision lookup and recording the confirm update.
function fakeAdminClient(opts: { customerId?: string; updates?: Record<string, unknown>[] } = {}) {
  const updates = opts.updates ?? []
  return () => ({
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      config: { existing: true },
                      automation_requests: { customer_id: opts.customerId ?? 'cust-1' },
                    },
                    error: null,
                  }),
              }
            },
          }
        },
        update(patch: Record<string, unknown>) {
          return {
            eq() {
              updates.push(patch)
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  })
}

function listFetcher(): SlackFetcher {
  return (url) => {
    if (url.includes('conversations.list')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, channels: [{ id: 'C1', name: 'general' }], response_metadata: { next_cursor: '' } }),
          { status: 200 },
        ),
      )
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }
}

function deps(overrides: Partial<SlackConfigureDeps> = {}): SlackConfigureDeps {
  return {
    createAdminClient: fakeAdminClient() as never,
    getUserId: () => Promise.resolve('cust-1'),
    getSlackToken: () => Promise.resolve('xoxb-tok'),
    slackFetcher: listFetcher(),
    ...overrides,
  }
}

function postReq(body: unknown): Request {
  return new Request('http://localhost/slack-configure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt' },
    body: JSON.stringify(body),
  })
}

Deno.test('list action returns the workspace channels', async () => {
  const res = await handleSlackConfigure(postReq({ provisionId: 'p1', action: 'list' }), deps())
  assertEquals(res.status, 200)
  const data = await res.json()
  assertEquals(data.channels, [{ id: 'C1', name: 'general' }])
})

Deno.test('confirm action persists the chosen channel and advances the provision', async () => {
  const updates: Record<string, unknown>[] = []
  const res = await handleSlackConfigure(
    postReq({ provisionId: 'p1', action: 'confirm', channelId: 'C1', channelName: 'general' }),
    deps({ createAdminClient: fakeAdminClient({ updates }) as never }),
  )
  assertEquals(res.status, 200)
  const cfg = updates[0].config as { channelId: string; existing: boolean }
  assertEquals(cfg.channelId, 'C1')
  // Existing config is preserved on merge.
  assertEquals(cfg.existing, true)
  assertEquals(updates[0].status, 'provisioning')
})

Deno.test('confirm rejects a missing channelId', async () => {
  const res = await handleSlackConfigure(postReq({ provisionId: 'p1', action: 'confirm' }), deps())
  assertEquals(res.status, 400)
})

Deno.test('rejects a caller who does not own the provision', async () => {
  const res = await handleSlackConfigure(
    postReq({ provisionId: 'p1', action: 'list' }),
    deps({ getUserId: () => Promise.resolve('someone-else') }),
  )
  assertEquals(res.status, 403)
})

Deno.test('rejects an unauthenticated caller', async () => {
  const res = await handleSlackConfigure(
    postReq({ provisionId: 'p1', action: 'list' }),
    deps({ getUserId: () => Promise.resolve(null) }),
  )
  assertEquals(res.status, 401)
})
