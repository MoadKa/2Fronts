import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  formatLeadMessage,
  listChannels,
  slackConnector,
  type SlackFetcher,
} from './slackConnector.ts'
import { getConnector } from './connectors.ts'

// A SlackFetcher that serves canned conversations.list pages and records
// chat.postMessage calls, so all three verbs run with no network.
function fakeSlack(opts: {
  channelPages?: { channels: { id: string; name: string }[]; next_cursor?: string }[]
  postOk?: boolean
  postError?: string
  listError?: string
}) {
  const posts: { url: string; body: string }[] = []
  let pageIndex = 0
  const fetcher: SlackFetcher = (url, init) => {
    if (url.includes('chat.postMessage')) {
      posts.push({ url, body: init?.body?.toString() ?? '' })
      if (opts.postError) {
        return Promise.resolve(new Response(JSON.stringify({ ok: false, error: opts.postError }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: opts.postOk ?? true, ts: '1.0' }), { status: 200 }))
    }
    // conversations.list
    if (opts.listError) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, error: opts.listError }), { status: 200 }))
    }
    const page = opts.channelPages?.[pageIndex] ?? { channels: [] }
    pageIndex++
    return Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          channels: page.channels,
          response_metadata: { next_cursor: page.next_cursor ?? '' },
        }),
        { status: 200 },
      ),
    )
  }
  return { fetcher, posts }
}

// --- registry ----------------------------------------------------------------

Deno.test('getConnector resolves the slack connector by type', () => {
  assertEquals(getConnector('slack_notifications'), slackConnector)
})

// --- connect (provision verb) ------------------------------------------------

Deno.test('slack provision succeeds with no external resource to claim', async () => {
  const outcome = await slackConnector.provision({
    adminClient: {} as never,
    row: { id: 'p1', connector_type: 'slack_notifications' },
    fromStatus: 'pending',
    deps: {},
  })
  assertEquals(outcome, 'active')
})

// --- configure ---------------------------------------------------------------

Deno.test('slack configure lists channels (paginating the cursor)', async () => {
  const { fetcher } = fakeSlack({
    channelPages: [
      { channels: [{ id: 'C1', name: 'general' }], next_cursor: 'CURSOR' },
      { channels: [{ id: 'C2', name: 'leads' }] },
    ],
  })

  const result = await slackConnector.configure!({
    row: { id: 'p1', connector_type: 'slack_notifications', config: {} },
    deps: { getAccessToken: () => Promise.resolve('xoxb-tok'), slackFetcher: fetcher },
  })

  assertEquals(result.headers, ['general', 'leads'])
  assertEquals(result.sampleRow, ['C1', 'C2'])
  assertEquals(result.proposedMapping.find((m) => m.field === 'leads')?.column, 'C2')
})

Deno.test('slack configure surfaces a Slack-level error', async () => {
  const { fetcher } = fakeSlack({ listError: 'invalid_auth' })
  await assertRejects(
    () =>
      slackConnector.configure!({
        row: { id: 'p1', connector_type: 'slack_notifications', config: {} },
        deps: { getAccessToken: () => Promise.resolve('xoxb-tok'), slackFetcher: fetcher },
      }),
    Error,
    'invalid_auth',
  )
})

Deno.test('slack configure fails loudly when getAccessToken is missing', async () => {
  const { fetcher } = fakeSlack({})
  await assertRejects(
    () =>
      slackConnector.configure!({
        row: { id: 'p1', connector_type: 'slack_notifications', config: {} },
        deps: { slackFetcher: fetcher },
      }),
    Error,
    'getAccessToken',
  )
})

// --- run ---------------------------------------------------------------------

Deno.test('slack run posts the lead to the confirmed channel via chat.postMessage', async () => {
  const { fetcher, posts } = fakeSlack({ postOk: true })

  const result = await slackConnector.run!({
    row: { id: 'p1', connector_type: 'slack_notifications', config: { channelId: 'C2', channelName: 'leads' } },
    lead: { id: 'l1', payload: { Name: 'Jan', Telefon: '+316', 'E-Mail': 'jan@x.nl' }, source: 'webform' },
    deps: { getAccessToken: () => Promise.resolve('xoxb-tok'), slackFetcher: fetcher },
  })

  assertEquals(result.outcome, 'filed')
  assertEquals(posts.length, 1)
  assertStringIncludes(posts[0].url, 'chat.postMessage')
  assertStringIncludes(posts[0].body, 'C2')
  assertStringIncludes(posts[0].body, 'Jan')
  assertStringIncludes(posts[0].body, '+316')
})

Deno.test('slack run holds for review when no channel is chosen yet', async () => {
  const { fetcher, posts } = fakeSlack({})

  const result = await slackConnector.run!({
    row: { id: 'p1', connector_type: 'slack_notifications', config: {} },
    lead: { id: 'l1', payload: { Name: 'Jan' } },
    deps: { getAccessToken: () => Promise.resolve('xoxb-tok'), slackFetcher: fetcher },
  })

  assertEquals(result.outcome, 'needs_review')
  assertEquals(posts.length, 0)
})

Deno.test('slack run reports failed (not filed) when chat.postMessage errors', async () => {
  const { fetcher } = fakeSlack({ postError: 'channel_not_found' })

  const result = await slackConnector.run!({
    row: { id: 'p1', connector_type: 'slack_notifications', config: { channelId: 'C9' } },
    lead: { id: 'l1', payload: { Name: 'Jan' } },
    deps: { getAccessToken: () => Promise.resolve('xoxb-tok'), slackFetcher: fetcher },
  })

  assertEquals(result.outcome, 'failed')
  assertStringIncludes(result.reason ?? '', 'channel_not_found')
})

// --- listChannels + formatLeadMessage helpers --------------------------------

Deno.test('listChannels collapses paginated results into one list', async () => {
  const { fetcher } = fakeSlack({
    channelPages: [
      { channels: [{ id: 'C1', name: 'a' }], next_cursor: 'X' },
      { channels: [{ id: 'C2', name: 'b' }] },
    ],
  })
  const channels = await listChannels('xoxb-tok', fetcher)
  assertEquals(channels, [{ id: 'C1', name: 'a' }, { id: 'C2', name: 'b' }])
})

Deno.test('formatLeadMessage orders known fields, appends extras, and includes the source', () => {
  const msg = formatLeadMessage({ Name: 'Jan', Telefon: '+316', Notiz: 'urgent' }, 'webform')
  assertStringIncludes(msg, '*Neuer Lead*')
  assertStringIncludes(msg, '*Name:* Jan')
  assertStringIncludes(msg, '*Telefon:* +316')
  assertStringIncludes(msg, '*Notiz:* urgent')
  assertStringIncludes(msg, 'webform')
  // Name must come before the extra Notiz field.
  const i = msg.indexOf('Name')
  const j = msg.indexOf('Notiz')
  assertEquals(i < j, true)
})
