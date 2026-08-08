import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { sendEmail, type Fetcher } from './email.ts'

// A key shaped like a real Resend one, so the redaction tests are meaningful.
// It is fake — nothing here ever reaches the network.
const FAKE_KEY = 're_TestKey_0123456789abcdefABCDEF'

interface Call {
  url: string
  method?: string
  headers: Record<string, string>
  body: string
}

// Records exactly what fetch was handed, so the tests can assert on the real
// outgoing headers rather than on a paraphrase of them.
function recordingFetcher(status: number, body = '{"id":"msg_1"}'): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = []
  const fetcher: Fetcher = (url, init) => {
    calls.push({
      url,
      method: init?.method,
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: init?.body?.toString() ?? '',
    })
    const payload = status === 204 || status === 205 ? null : body
    return Promise.resolve(new Response(payload, { status }))
  }
  return { fetcher, calls }
}

const baseArgs = {
  apiKey: FAKE_KEY,
  from: '2Fronts <hallo@example.test>',
  to: 'kunde@example.test',
  subject: 'Betreff',
  text: 'Inhalt',
}

Deno.test('sends to the Resend endpoint and returns the message id on 2xx', async () => {
  const { fetcher, calls } = recordingFetcher(200, '{"id":"msg_abc123"}')

  const res = await sendEmail(baseArgs, { fetcher })

  assertEquals(res.ok, true)
  assertEquals(res.status, 200)
  assertEquals(res.id, 'msg_abc123')
  assertEquals(res.retryable, false)
  assertEquals(res.indeterminate, false)
  assertEquals(calls.length, 1)
  assertEquals(calls[0].url, 'https://api.resend.com/emails')
  assertEquals(calls[0].method, 'POST')
  assertEquals(calls[0].headers.Authorization, `Bearer ${FAKE_KEY}`)
})

Deno.test('a 2xx whose body is not JSON is still a success, just without an id', async () => {
  const { fetcher } = recordingFetcher(200, 'not json at all')
  const res = await sendEmail(baseArgs, { fetcher })
  assertEquals(res.ok, true)
  assertEquals(res.id, undefined)
  assertEquals(res.indeterminate, false)
})

// --- Idempotency-Key -------------------------------------------------------

Deno.test('Idempotency-Key is sent verbatim when an idempotencyKey is passed', async () => {
  const { fetcher, calls } = recordingFetcher(200)
  const key = 'followup:req-42:attempt-1'

  await sendEmail({ ...baseArgs, idempotencyKey: key }, { fetcher })

  assertEquals(calls[0].headers['Idempotency-Key'], key)
})

Deno.test('Idempotency-Key header is absent entirely when no key is passed', async () => {
  const { fetcher, calls } = recordingFetcher(200)

  await sendEmail(baseArgs, { fetcher })

  assert(!('Idempotency-Key' in calls[0].headers), 'Idempotency-Key must not be present')
  // Also absent under a case-insensitive reading of the outgoing headers.
  assertEquals(new Headers(calls[0].headers).get('Idempotency-Key'), null)
})

Deno.test('an empty idempotencyKey is treated as not passed (no empty header)', async () => {
  const { fetcher, calls } = recordingFetcher(200)

  await sendEmail({ ...baseArgs, idempotencyKey: '' }, { fetcher })

  assert(!('Idempotency-Key' in calls[0].headers))
})

// --- Custom headers --------------------------------------------------------

Deno.test('custom headers reach the request unmodified', async () => {
  const { fetcher, calls } = recordingFetcher(200)
  const custom = {
    'X-Entity-Ref-ID': 'ref-99',
    'x-lower-case': 'Mixed Value With Spaces',
    'X-Unicode': 'Grüße, Ösel',
  }

  await sendEmail({ ...baseArgs, headers: custom }, { fetcher })

  for (const [name, value] of Object.entries(custom)) {
    assertEquals(calls[0].headers[name], value)
  }
})

Deno.test('custom headers cannot clobber the credential or the idempotency key', async () => {
  const { fetcher, calls } = recordingFetcher(200)

  await sendEmail(
    {
      ...baseArgs,
      idempotencyKey: 'real-key',
      headers: { Authorization: 'Bearer attacker', 'Idempotency-Key': 'wrong-key' },
    },
    { fetcher },
  )

  assertEquals(calls[0].headers.Authorization, `Bearer ${FAKE_KEY}`)
  assertEquals(calls[0].headers['Idempotency-Key'], 'real-key')
})

// --- Definite failures: known rejection, never indeterminate ---------------

Deno.test('a 400 is a definite, non-retryable failure and does not throw', async () => {
  const { fetcher } = recordingFetcher(400, '{"message":"invalid from address"}')

  const res = await sendEmail(baseArgs, { fetcher })

  assertEquals(res.ok, false)
  assertEquals(res.status, 400)
  assertEquals(res.retryable, false)
  assertEquals(res.indeterminate, false)
  assertStringIncludes(res.error ?? '', 'invalid from address')
})

Deno.test('a 429 is a definite failure that IS retryable', async () => {
  const { fetcher } = recordingFetcher(429, '{"message":"rate limit exceeded"}')

  const res = await sendEmail(baseArgs, { fetcher })

  assertEquals(res.ok, false)
  assertEquals(res.status, 429)
  assertEquals(res.retryable, true)
  assertEquals(res.indeterminate, false)
})

Deno.test('a 503 is a definite failure that IS retryable', async () => {
  const { fetcher } = recordingFetcher(503, 'service unavailable')

  const res = await sendEmail(baseArgs, { fetcher })

  assertEquals(res.ok, false)
  assertEquals(res.status, 503)
  assertEquals(res.retryable, true)
  assertEquals(res.indeterminate, false)
})

Deno.test('a 500 with an empty body still reports a usable error', async () => {
  const { fetcher } = recordingFetcher(500, '')

  const res = await sendEmail(baseArgs, { fetcher })

  assertEquals(res.ok, false)
  assertEquals(res.retryable, true)
  assertEquals(res.indeterminate, false)
  assertEquals(res.error, 'HTTP 500')
})

// --- Indeterminate failures: outcome unknown -------------------------------

Deno.test('a fetch that throws is retryable AND indeterminate', async () => {
  const fetcher: Fetcher = () => Promise.reject(new Error('connection reset'))

  const res = await sendEmail(baseArgs, { fetcher })

  assertEquals(res.ok, false)
  assertEquals(res.retryable, true)
  assertEquals(res.indeterminate, true)
  // No status: we never saw a response.
  assertEquals(res.status, undefined)
  assertStringIncludes(res.error ?? '', 'connection reset')
})

Deno.test('an AbortError is retryable AND indeterminate', async () => {
  const fetcher: Fetcher = () => Promise.reject(new DOMException('The signal has been aborted', 'AbortError'))

  const res = await sendEmail(baseArgs, { fetcher })

  assertEquals(res.ok, false)
  assertEquals(res.retryable, true)
  assertEquals(res.indeterminate, true)
  assertStringIncludes(res.error ?? '', 'aborted')
})

Deno.test('a synchronously throwing fetcher is caught too', async () => {
  const fetcher: Fetcher = () => {
    throw new Error('boom before the request')
  }

  const res = await sendEmail(baseArgs, { fetcher })

  assertEquals(res.ok, false)
  assertEquals(res.indeterminate, true)
  assertEquals(res.retryable, true)
})

// --- Credential never escapes ----------------------------------------------

Deno.test('the API key never appears in the returned error, even when the body echoes it', async () => {
  const echoing = `{"message":"API key ${FAKE_KEY} is invalid","name":"validation_error"}`
  const { fetcher } = recordingFetcher(401, echoing)

  const res = await sendEmail(baseArgs, { fetcher })

  assertEquals(res.ok, false)
  assert(!(res.error ?? '').includes(FAKE_KEY), 'API key leaked into the returned error')
  assertStringIncludes(res.error ?? '', '[redacted]')
  // Still a useful diagnostic, minus the credential.
  assertStringIncludes(res.error ?? '', 'validation_error')
})

Deno.test('the API key never appears in a thrown error message either', async () => {
  const fetcher: Fetcher = () => Promise.reject(new Error(`bad credential Bearer ${FAKE_KEY}`))

  const res = await sendEmail(baseArgs, { fetcher })

  assert(!(res.error ?? '').includes(FAKE_KEY), 'API key leaked into the returned error')
  assertEquals(res.indeterminate, true)
})

Deno.test('the API key never reaches console.error', async () => {
  const logged: string[] = []
  const original = console.error
  console.error = (...parts: unknown[]) => {
    logged.push(parts.map((p) => String(p)).join(' '))
  }
  try {
    const echoing = `{"message":"API key ${FAKE_KEY} is invalid"}`
    const { fetcher } = recordingFetcher(401, echoing)
    await sendEmail(baseArgs, { fetcher })
    await sendEmail(baseArgs, { fetcher: () => Promise.reject(new Error(`key was ${FAKE_KEY}`)) })
  } finally {
    console.error = original
  }

  assert(logged.length > 0, 'expected the failures to be logged at all')
  for (const line of logged) {
    assert(!line.includes(FAKE_KEY), `API key leaked into a log line: ${line}`)
  }
})

Deno.test('an oversized error body is bounded, and redacted before truncation', async () => {
  // Key first, then enough filler to push past the cap: proves the redaction
  // runs on the whole body, not just on the slice we keep.
  const huge = `${FAKE_KEY}${'x'.repeat(5000)}${FAKE_KEY}`
  const { fetcher } = recordingFetcher(400, huge)

  const res = await sendEmail(baseArgs, { fetcher })

  assert(!(res.error ?? '').includes(FAKE_KEY))
  assert((res.error ?? '').length <= 1001, `error not bounded: ${(res.error ?? '').length}`)
})

// --- Payload ---------------------------------------------------------------

Deno.test('replyTo is sent as reply_to, and omitted when not passed', async () => {
  const withReply = recordingFetcher(200)
  await sendEmail({ ...baseArgs, replyTo: 'antwort@example.test' }, { fetcher: withReply.fetcher })
  assertEquals(JSON.parse(withReply.calls[0].body).reply_to, 'antwort@example.test')

  const without = recordingFetcher(200)
  await sendEmail(baseArgs, { fetcher: without.fetcher })
  assert(!('reply_to' in JSON.parse(without.calls[0].body)))
})

Deno.test('an array of recipients and an html body are passed through', async () => {
  const { fetcher, calls } = recordingFetcher(200)

  await sendEmail(
    { ...baseArgs, to: ['a@example.test', 'b@example.test'], text: undefined, html: '<p>hi</p>' },
    { fetcher },
  )

  const payload = JSON.parse(calls[0].body)
  assertEquals(payload.to, ['a@example.test', 'b@example.test'])
  assertEquals(payload.html, '<p>hi</p>')
  assert(!('text' in payload))
})

// --- Local guards: nothing was sent, so nothing to retry --------------------

Deno.test('a missing API key fails definitively without calling fetch', async () => {
  const { fetcher, calls } = recordingFetcher(200)

  const res = await sendEmail({ ...baseArgs, apiKey: '' }, { fetcher })

  assertEquals(res.ok, false)
  assertEquals(res.error, 'missing_api_key')
  assertEquals(res.retryable, false)
  assertEquals(res.indeterminate, false)
  assertEquals(calls.length, 0)
})

Deno.test('a missing text/html body fails definitively without calling fetch', async () => {
  const { fetcher, calls } = recordingFetcher(200)

  const res = await sendEmail({ ...baseArgs, text: undefined }, { fetcher })

  assertEquals(res.ok, false)
  assertEquals(res.error, 'missing_body')
  assertEquals(res.retryable, false)
  assertEquals(res.indeterminate, false)
  assertEquals(calls.length, 0)
})
