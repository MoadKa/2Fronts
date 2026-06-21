import { assert, assertEquals } from 'jsr:@std/assert@1'
import { alert, alertNeedsReview, alertProvisionFailed, type Fetcher } from './alerting.ts'

// A fake fetcher that records what it was called with. The url is fake on
// purpose -- no real webhook URL ever appears in these tests.
function recordingFetcher(status = 200): { fetcher: Fetcher; calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = []
  const fetcher: Fetcher = (url, init) => {
    calls.push({ url, body: init?.body?.toString() ?? '' })
    // 204/205 forbid a response body, so only attach one for other statuses.
    const body = status === 204 || status === 205 ? null : 'ok'
    return Promise.resolve(new Response(body, { status }))
  }
  return { fetcher, calls }
}

// Save/restore ALERT_WEBHOOK_URL around a test body so tests never leak env.
async function withEnv(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get('ALERT_WEBHOOK_URL')
  if (value === undefined) {
    Deno.env.delete('ALERT_WEBHOOK_URL')
  } else {
    Deno.env.set('ALERT_WEBHOOK_URL', value)
  }
  try {
    await fn()
  } finally {
    if (prev === undefined) {
      Deno.env.delete('ALERT_WEBHOOK_URL')
    } else {
      Deno.env.set('ALERT_WEBHOOK_URL', prev)
    }
  }
}

const FAKE_HOOK = 'https://example.test/hook'

Deno.test('alert() POSTs to ALERT_WEBHOOK_URL and returns true on a 2xx', async () => {
  await withEnv(FAKE_HOOK, async () => {
    const { fetcher, calls } = recordingFetcher(200)

    const ok = await alert({ type: 'test', message: 'hello operator', fields: { a: 1 } }, { fetcher })

    assertEquals(ok, true)
    assertEquals(calls.length, 1)
    assertEquals(calls[0].url, FAKE_HOOK)
    assert(calls[0].body.includes('hello operator'))
    assert(calls[0].body.includes('"a":1'))
  })
})

Deno.test('alert() returns true on any 2xx status (e.g. 204)', async () => {
  await withEnv(FAKE_HOOK, async () => {
    const { fetcher } = recordingFetcher(204)
    const ok = await alert({ type: 'test', message: 'noop body' }, { fetcher })
    assertEquals(ok, true)
  })
})

Deno.test('alert() returns false and is a no-op (fetcher NOT called) when ALERT_WEBHOOK_URL is unset', async () => {
  await withEnv(undefined, async () => {
    const { fetcher, calls } = recordingFetcher(200)

    const ok = await alert({ type: 'test', message: 'should not send' }, { fetcher })

    assertEquals(ok, false)
    assertEquals(calls.length, 0)
  })
})

Deno.test('alert() returns false on a non-2xx response', async () => {
  await withEnv(FAKE_HOOK, async () => {
    const { fetcher } = recordingFetcher(500)
    const ok = await alert({ type: 'test', message: 'server error' }, { fetcher })
    assertEquals(ok, false)
  })
})

Deno.test('alert() swallows a fetcher that throws (network error) and returns false', async () => {
  await withEnv(FAKE_HOOK, async () => {
    const throwingFetcher: Fetcher = () => Promise.reject(new Error('network down'))
    // Must not throw.
    const ok = await alert({ type: 'test', message: 'boom' }, { fetcher: throwingFetcher })
    assertEquals(ok, false)
  })
})

Deno.test('alertNeedsReview produces a body containing the leadId and returns true', async () => {
  await withEnv(FAKE_HOOK, async () => {
    const { fetcher, calls } = recordingFetcher(200)

    const ok = await alertNeedsReview(
      { leadId: 'lead-123', customerId: 'cust-9', reason: 'low confidence match' },
      { fetcher },
    )

    assertEquals(ok, true)
    assert(calls[0].body.includes('lead-123'))
    assert(calls[0].body.includes('cust-9'))
    assert(calls[0].body.includes('low confidence match'))
    assert(calls[0].body.includes('needs_review'))
  })
})

Deno.test('alertProvisionFailed produces a body containing the provisionId and returns true', async () => {
  await withEnv(FAKE_HOOK, async () => {
    const { fetcher, calls } = recordingFetcher(200)

    const ok = await alertProvisionFailed(
      { provisionId: 'prov-77', connectorType: 'google_sheets', error: 'token expired' },
      { fetcher },
    )

    assertEquals(ok, true)
    assert(calls[0].body.includes('prov-77'))
    assert(calls[0].body.includes('google_sheets'))
    assert(calls[0].body.includes('token expired'))
    assert(calls[0].body.includes('provision_failed'))
  })
})

Deno.test('helpers are a safe no-op when ALERT_WEBHOOK_URL is unset', async () => {
  await withEnv(undefined, async () => {
    const { fetcher, calls } = recordingFetcher(200)
    const a = await alertNeedsReview({ leadId: 'l', customerId: 'c', reason: 'r' }, { fetcher })
    const b = await alertProvisionFailed({ provisionId: 'p', connectorType: 't', error: 'e' }, { fetcher })
    assertEquals(a, false)
    assertEquals(b, false)
    assertEquals(calls.length, 0)
  })
})

Deno.test('an explicit empty webhookUrl dep is treated as unconfigured (no-op)', async () => {
  // Even if the env happens to be set, an explicit empty override means "off".
  await withEnv(FAKE_HOOK, async () => {
    const { fetcher, calls } = recordingFetcher(200)
    const ok = await alert({ type: 'test', message: 'x' }, { fetcher, webhookUrl: '' })
    assertEquals(ok, false)
    assertEquals(calls.length, 0)
  })
})
