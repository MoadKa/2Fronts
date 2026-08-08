import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  GLOBAL_SUPPRESSION_CONCIERGE_ID,
  handleResendWebhook,
  type ResendWebhookDeps,
} from './index.ts'

// A realistic Svix signing key: `whsec_` + standard base64 of the raw bytes.
const SECRET = `whsec_${btoa('a-32-byte-ish-signing-key-value!')}`
const OTHER_SECRET = `whsec_${btoa('somebody-elses-signing-key-value')}`

const NOW = new Date('2026-08-12T12:00:00.000Z')
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)

const ADDRESS = 'Visitor@Example.test'
const NORMALIZED = 'visitor@example.test'
const CONCIERGE_A = '11111111-1111-4111-8111-111111111111'
const CONCIERGE_B = '22222222-2222-4222-8222-222222222222'

// --- The signer, written independently of the verifier ----------------------
//
// Deliberately NOT importing anything from index.ts here: a test that signs with
// the code it is testing proves only that the function agrees with itself.

async function sign(body: string, secret: string, id: string, timestampSeconds: number): Promise<string> {
  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  const bin = atob(raw)
  const keyBytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) keyBytes[i] = bin.charCodeAt(i)
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestampSeconds}.${body}`)),
  )
  let out = ''
  for (let i = 0; i < sig.length; i++) out += String.fromCharCode(sig[i])
  return `v1,${btoa(out)}`
}

// --- Payloads ---------------------------------------------------------------

function bounced(opts: { to?: unknown; bounceType?: string | null } = {}): string {
  const bounce = opts.bounceType === null ? undefined : {
    message: 'The email account that you tried to reach does not exist.',
    subType: 'General',
    type: opts.bounceType ?? 'Permanent',
  }
  return JSON.stringify({
    type: 'email.bounced',
    created_at: '2026-08-12T11:59:00.000Z',
    data: {
      created_at: '2026-08-12T11:58:00.000Z',
      email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
      from: 'Coach Meier <setter@2fronts.de>',
      // `'to' in opts` rather than ??, so a test can ask for a payload with no
      // recipient at all (JSON.stringify drops an undefined value).
      to: 'to' in opts ? opts.to : [ADDRESS],
      subject: 'Kurz zu unserem Gespräch',
      ...(bounce ? { bounce } : {}),
    },
  })
}

function complained(to: unknown = [ADDRESS]): string {
  return JSON.stringify({
    type: 'email.complained',
    created_at: '2026-08-12T11:59:00.000Z',
    data: {
      created_at: '2026-08-12T11:58:00.000Z',
      email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
      from: 'Coach Meier <setter@2fronts.de>',
      to,
      subject: 'Kurz zu unserem Gespräch',
    },
  })
}

// --- The fake client --------------------------------------------------------

interface Scan {
  table: string
  columns: string
  column: string
  value: unknown
  limit: number
}

interface RpcCall {
  name: string
  args: Record<string, unknown>
}

interface Fake {
  adminCalls: number
  scans: Scan[]
  rpcs: RpcCall[]
}

interface FakeOptions {
  /** Outbox rows the scan finds for the address. */
  outboxRows?: Array<{ concierge_id: string }>
  scanError?: { message: string } | null
  rpcError?: { message: string } | null
  /** What the unsubscribe RPC reports it cancelled. */
  cancelled?: number
  throwOnAdmin?: boolean
  secret?: string | undefined
}

function makeFake(opts: FakeOptions = {}): { fake: Fake; deps: ResendWebhookDeps } {
  const fake: Fake = { adminCalls: 0, scans: [], rpcs: [] }
  const rows = opts.outboxRows ?? [{ concierge_id: CONCIERGE_A }]

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const builder = {
            eq(column: string, value: unknown) {
              return {
                limit(n: number) {
                  fake.scans.push({ table, columns, column, value, limit: n })
                  return Promise.resolve(
                    opts.scanError ? { data: null, error: opts.scanError } : { data: rows, error: null },
                  )
                },
              }
            },
          }
          return builder
        },
      }
    },
    rpc(name: string, args: Record<string, unknown>) {
      fake.rpcs.push({ name, args })
      return Promise.resolve(
        opts.rpcError ? { data: null, error: opts.rpcError } : { data: opts.cancelled ?? 1, error: null },
      )
    },
  }

  const deps: ResendWebhookDeps = {
    createAdminClient: () => {
      fake.adminCalls++
      if (opts.throwOnAdmin) throw new Error('no service role key')
      return client as never
    },
    env: (key) => (key === 'RESEND_WEBHOOK_SECRET' ? ('secret' in opts ? opts.secret : SECRET) : undefined),
    now: () => NOW,
  }

  return { fake, deps }
}

interface PostOptions {
  secret?: string
  id?: string
  timestamp?: number
  /** Omit the signature headers entirely. */
  unsigned?: boolean
  /** Replace the signature header value verbatim. */
  signature?: string
  method?: string
  headerStyle?: 'svix' | 'webhook'
}

async function post(body: string, deps: ResendWebhookDeps, opts: PostOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!opts.unsigned) {
    const id = opts.id ?? 'msg_2fronts_test'
    const ts = opts.timestamp ?? NOW_SECONDS
    const signature = opts.signature ?? (await sign(body, opts.secret ?? SECRET, id, ts))
    const prefix = opts.headerStyle === 'webhook' ? 'webhook' : 'svix'
    headers[`${prefix}-id`] = id
    headers[`${prefix}-timestamp`] = String(ts)
    headers[`${prefix}-signature`] = signature
  }
  return await handleResendWebhook(
    new Request('https://ref.functions.test/resend-webhook', {
      method: opts.method ?? 'POST',
      headers,
      body,
    }),
    deps,
  )
}

// Capture everything the handler writes to the console, so a test can assert
// what is NOT in it.
async function withCapturedLogs<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = []
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info }
  const record = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  }
  console.log = record
  console.warn = record
  console.error = record
  console.info = record
  try {
    const result = await fn()
    return { result, lines }
  } finally {
    console.log = original.log
    console.warn = original.warn
    console.error = original.error
    console.info = original.info
  }
}

// ---------------------------------------------------------------------------
// The two events that matter
// ---------------------------------------------------------------------------

Deno.test('a signed email.bounced suppresses the address and cancels its queued mail', async () => {
  const { fake, deps } = makeFake({ cancelled: 2 })
  const res = await post(bounced(), deps)

  assertEquals(res.status, 200)
  assertEquals(await res.text(), JSON.stringify({ received: true }))

  // It asked the outbox who has mailed, or is about to mail, this address —
  // by the NORMALISED form, the one the sender writes.
  assertEquals(fake.scans.length, 1)
  assertEquals(fake.scans[0].table, 'concierge_followup_outbox')
  assertEquals(fake.scans[0].column, 'email_normalized')
  assertEquals(fake.scans[0].value, NORMALIZED)

  // One suppression per sender that knows the address, plus the global one.
  // Both go through the RPC, which is what also cancels the queued rows.
  assertEquals(fake.rpcs.length, 2)
  for (const call of fake.rpcs) {
    assertEquals(call.name, 'concierge_followup_unsubscribe')
    assertEquals(call.args.p_email, NORMALIZED)
    assertEquals(call.args.p_source, 'provider_bounce')
  }
  const senders = fake.rpcs.map((c) => c.args.p_concierge_id)
  assert(senders.includes(GLOBAL_SUPPRESSION_CONCIERGE_ID), 'no global suppression was written')
  assert(senders.includes(CONCIERGE_A), 'the sender that queued the mail was not suppressed')
})

Deno.test('a signed email.complained does the same, globally', async () => {
  const { fake, deps } = makeFake()
  const res = await post(complained(), deps)

  assertEquals(res.status, 200)
  assertEquals(fake.rpcs.length, 2)
  const senders = fake.rpcs.map((c) => c.args.p_concierge_id)
  assert(senders.includes(GLOBAL_SUPPRESSION_CONCIERGE_ID))
  assert(senders.includes(CONCIERGE_A))
  assertEquals(fake.rpcs[0].args.p_email, NORMALIZED)
})

Deno.test('every sender that knows the address is suppressed, not just the one that bounced', async () => {
  // The whole point: one coach's dead address is dead for the next coach too.
  const { fake, deps } = makeFake({
    outboxRows: [
      { concierge_id: CONCIERGE_A },
      { concierge_id: CONCIERGE_B },
      { concierge_id: CONCIERGE_A }, // a second row for the same sender
    ],
  })
  await post(bounced(), deps)

  const senders = new Set(fake.rpcs.map((c) => c.args.p_concierge_id))
  assertEquals(senders.size, 3, 'duplicate sender ids were not collapsed')
  assert(senders.has(GLOBAL_SUPPRESSION_CONCIERGE_ID))
  assert(senders.has(CONCIERGE_A))
  assert(senders.has(CONCIERGE_B))
})

Deno.test('an address nobody has ever mailed still gets the global suppression', async () => {
  const { fake, deps } = makeFake({ outboxRows: [] })
  const res = await post(bounced(), deps)

  assertEquals(res.status, 200)
  assertEquals(fake.rpcs.length, 1)
  assertEquals(fake.rpcs[0].args.p_concierge_id, GLOBAL_SUPPRESSION_CONCIERGE_ID)
})

Deno.test('a Transient bounce suppresses per sender but NOT globally', async () => {
  // A full mailbox on a Tuesday must not block every coach on the platform
  // from ever mailing that person again.
  const { fake, deps } = makeFake()
  const res = await post(bounced({ bounceType: 'Transient' }), deps)

  assertEquals(res.status, 200)
  assertEquals(fake.rpcs.length, 1)
  assertEquals(fake.rpcs[0].args.p_concierge_id, CONCIERGE_A)
})

Deno.test('a bounce with no readable type is treated as permanent', async () => {
  for (const payload of [bounced({ bounceType: null }), bounced({ bounceType: 'Undetermined' })]) {
    const { fake, deps } = makeFake()
    await post(payload, deps)
    const senders = fake.rpcs.map((c) => c.args.p_concierge_id)
    assert(senders.includes(GLOBAL_SUPPRESSION_CONCIERGE_ID), `payload ${payload} failed open`)
  }
})

Deno.test('a Transient COMPLAINT is a contradiction we ignore: a complaint is always global', async () => {
  const payload = JSON.parse(complained()) as Record<string, unknown>
  ;(payload.data as Record<string, unknown>).bounce = { type: 'Transient' }
  const { fake, deps } = makeFake()
  await post(JSON.stringify(payload), deps)

  const senders = fake.rpcs.map((c) => c.args.p_concierge_id)
  assert(senders.includes(GLOBAL_SUPPRESSION_CONCIERGE_ID))
})

Deno.test('a display-name recipient is unwrapped and normalised', async () => {
  const { fake, deps } = makeFake()
  await post(bounced({ to: ['Max Mustermann <MAX@Example.TEST>'] }), deps)
  assertEquals(fake.scans[0].value, 'max@example.test')
  assertEquals(fake.rpcs[0].args.p_email, 'max@example.test')
})

// ---------------------------------------------------------------------------
// Nothing reaches the database without a valid signature
// ---------------------------------------------------------------------------

Deno.test('an UNSIGNED payload is rejected and constructs no admin client', async () => {
  const { fake, deps } = makeFake()
  const res = await post(bounced(), deps, { unsigned: true })

  assertEquals(res.status, 400)
  assertEquals(fake.adminCalls, 0, 'an unsigned request reached the database')
  assertEquals(fake.scans.length, 0)
  assertEquals(fake.rpcs.length, 0)
})

Deno.test('a payload signed with the wrong secret is rejected before any client exists', async () => {
  const { fake, deps } = makeFake()
  const res = await post(bounced(), deps, { secret: OTHER_SECRET })

  assertEquals(res.status, 400)
  assertEquals(fake.adminCalls, 0)
  assertEquals(fake.rpcs.length, 0)
})

Deno.test('a stale timestamp is rejected: a captured payload cannot be replayed forever', async () => {
  const { fake, deps } = makeFake()
  // Correctly signed for its own timestamp — an hour ago.
  const res = await post(bounced(), deps, { timestamp: NOW_SECONDS - 3600 })

  assertEquals(res.status, 400)
  assertEquals(fake.adminCalls, 0)
})

Deno.test('a timestamp from the future is rejected too, and the edges of the window hold', async () => {
  const future = makeFake()
  assertEquals((await post(bounced(), future.deps, { timestamp: NOW_SECONDS + 3600 })).status, 400)
  assertEquals(future.fake.adminCalls, 0)

  // Just inside five minutes: accepted.
  const inside = makeFake()
  assertEquals((await post(bounced(), inside.deps, { timestamp: NOW_SECONDS - 299 })).status, 200)

  // Just outside: refused.
  const outside = makeFake()
  assertEquals((await post(bounced(), outside.deps, { timestamp: NOW_SECONDS - 301 })).status, 400)
  assertEquals(outside.fake.adminCalls, 0)
})

Deno.test('a signature that does not cover THIS body is refused', async () => {
  const { fake, deps } = makeFake()
  const signature = await sign(bounced(), SECRET, 'msg_2fronts_test', NOW_SECONDS)
  // Same signature, different body: the classic swap.
  const res = await post(complained(), deps, { signature })

  assertEquals(res.status, 400)
  assertEquals(fake.adminCalls, 0)
})

Deno.test('a signature bound to a different svix-id is refused', async () => {
  const { fake, deps } = makeFake()
  const body = bounced()
  const signature = await sign(body, SECRET, 'msg_other', NOW_SECONDS)
  const res = await post(body, deps, { signature, id: 'msg_2fronts_test' })

  assertEquals(res.status, 400)
  assertEquals(fake.adminCalls, 0)
})

Deno.test('malformed, empty and non-v1 signature headers all fail closed', async () => {
  const body = bounced()
  const good = (await sign(body, SECRET, 'msg_2fronts_test', NOW_SECONDS)).slice('v1,'.length)
  const cases = [
    '',
    'nonsense',
    good, // right value, no version prefix
    `v0,${good}`, // a version we do not accept
    `v1,${good.slice(0, -1)}A`, // one character off
    `v1,${good}x`, // length mismatch
    'v1,',
  ]
  for (const signature of cases) {
    const { fake, deps } = makeFake()
    const res = await post(body, deps, { signature })
    assertEquals(res.status, 400, `case "${signature}" was accepted`)
    assertEquals(fake.adminCalls, 0, `case "${signature}" reached the database`)
  }
})

Deno.test('several offered signatures are accepted if any one matches (key rotation)', async () => {
  const body = bounced()
  const wrong = await sign(body, OTHER_SECRET, 'msg_2fronts_test', NOW_SECONDS)
  const right = await sign(body, SECRET, 'msg_2fronts_test', NOW_SECONDS)
  const { fake, deps } = makeFake()

  const res = await post(body, deps, { signature: `${wrong} ${right}` })
  assertEquals(res.status, 200)
  assert(fake.rpcs.length > 0)
})

Deno.test('the vendor-neutral webhook-* header spelling is accepted', async () => {
  const { fake, deps } = makeFake()
  const res = await post(bounced(), deps, { headerStyle: 'webhook' })
  assertEquals(res.status, 200)
  assert(fake.rpcs.length > 0)
})

Deno.test('a missing RESEND_WEBHOOK_SECRET fails closed without touching the database', async () => {
  const { fake, deps } = makeFake({ secret: undefined })
  const res = await post(bounced(), deps)

  assertEquals(res.status, 500, 'a misconfigured endpoint must ask for a retry, not swallow the event')
  assertEquals(fake.adminCalls, 0)
})

Deno.test('a GET is refused without reading a body or building a client', async () => {
  const { fake, deps } = makeFake()
  const res = await handleResendWebhook(
    new Request('https://ref.functions.test/resend-webhook', { method: 'GET' }),
    deps,
  )
  assertEquals(res.status, 405)
  assertEquals(fake.adminCalls, 0)
})

Deno.test('an oversized body is refused before the HMAC runs', async () => {
  const { fake, deps } = makeFake()
  const huge = JSON.stringify({ type: 'email.bounced', data: { to: [ADDRESS], pad: 'x'.repeat(70_000) } })
  // Correctly signed — size alone is the refusal.
  const res = await post(huge, deps)
  assertEquals(res.status, 400)
  assertEquals(fake.adminCalls, 0)
})

// ---------------------------------------------------------------------------
// Events we do not handle
// ---------------------------------------------------------------------------

Deno.test('an unhandled event type returns 200 and writes nothing', async () => {
  for (const type of ['email.sent', 'email.delivered', 'email.opened', 'email.clicked', 'contact.created']) {
    const { fake, deps } = makeFake()
    const res = await post(JSON.stringify({ type, data: { to: [ADDRESS] } }), deps)

    assertEquals(res.status, 200, `${type} was not answered 200`)
    assertEquals(await res.text(), JSON.stringify({ received: true }))
    // A 4xx here would make the provider retry forever and eventually disable
    // the endpoint, taking the bounce events down with it.
    assertEquals(fake.rpcs.length, 0, `${type} wrote a suppression`)
    assertEquals(fake.scans.length, 0)
    assertEquals(fake.adminCalls, 0, `${type} built a client for nothing`)
  }
})

Deno.test('a signed payload with no type, or a non-string type, is a quiet 200', async () => {
  for (const body of ['{}', JSON.stringify({ type: 7, data: { to: [ADDRESS] } })]) {
    const { fake, deps } = makeFake()
    const res = await post(body, deps)
    assertEquals(res.status, 200)
    assertEquals(fake.rpcs.length, 0)
  }
})

Deno.test('a bounce we cannot attribute to an address is a 200 that writes nothing', async () => {
  for (const to of [undefined, [], ['Max Mustermann'], [123], 'not-an-address', ['a'.repeat(400) + '@x.test']]) {
    const { fake, deps } = makeFake()
    const res = await post(bounced({ to }), deps)
    assertEquals(res.status, 200, `to=${JSON.stringify(to)} was not a 200`)
    assertEquals(fake.adminCalls, 0, `to=${JSON.stringify(to)} built a client`)
    assertEquals(fake.rpcs.length, 0)
  }
})

Deno.test('a signed payload that is not JSON is refused, not retried into a loop', async () => {
  const { fake, deps } = makeFake()
  const res = await post('this is not json', deps)
  assertEquals(res.status, 400)
  assertEquals(fake.adminCalls, 0)
})

// ---------------------------------------------------------------------------
// Failures never become a silent success
// ---------------------------------------------------------------------------

Deno.test('a failing outbox scan is NOT read as "no senders"', async () => {
  const { fake, deps } = makeFake({ scanError: { message: 'connection reset' } })
  const res = await post(bounced(), deps)

  // No suppression at all, and a 500 so the provider sends it again. Treating a
  // failed scan as an empty one would leave queued mail in place for an address
  // that just bounced.
  assertEquals(res.status, 500)
  assertEquals(fake.rpcs.length, 0)
})

Deno.test('a failing suppression RPC answers 500 so the event is redelivered', async () => {
  const { fake, deps } = makeFake({ rpcError: { message: 'permission denied' } })
  const res = await post(bounced(), deps)

  assertEquals(res.status, 500)
  assertEquals(fake.rpcs.length, 2, 'one failure stopped the other sender being tried')
})

Deno.test('an admin client that throws is answered 500, not a stack trace', async () => {
  const { deps } = makeFake({ throwOnAdmin: true })
  const res = await post(bounced(), deps)
  assertEquals(res.status, 500)
  assertStringIncludes(await res.text(), 'unavailable')
})

Deno.test('a deps object that throws on every call still returns a Response', async () => {
  const hostile: ResendWebhookDeps = {
    createAdminClient: () => {
      throw new Error('boom')
    },
    env: () => {
      throw new Error('boom')
    },
    now: () => {
      throw new Error('boom')
    },
  }
  const res = await handleResendWebhook(
    new Request('https://ref.functions.test/resend-webhook', { method: 'POST', body: bounced() }),
    hostile,
  )
  assertEquals(res.status, 500)
  await res.body?.cancel()
})

Deno.test('a redelivery repeats the same idempotent writes and answers 200 again', async () => {
  const body = bounced()
  const first = makeFake({ cancelled: 2 })
  const second = makeFake({ cancelled: 0 }) // nothing left to cancel the second time

  const firstRes = await post(body, first.deps)
  const secondRes = await post(body, second.deps)

  assertEquals(firstRes.status, 200)
  assertEquals(secondRes.status, 200)
  assertEquals(await firstRes.text(), await secondRes.text())
  assertEquals(second.fake.rpcs.length, first.fake.rpcs.length)
})

// ---------------------------------------------------------------------------
// The address never leaves this function
// ---------------------------------------------------------------------------

Deno.test('no log line and no response body contains the recipient address', async () => {
  const bodies: string[] = []
  const { lines } = await withCapturedLogs(async () => {
    const cases: Array<[string, PostOptions]> = [
      [bounced(), {}],
      [complained(), {}],
      [bounced({ bounceType: 'Transient' }), {}],
      [bounced(), { unsigned: true }],
      [bounced(), { secret: OTHER_SECRET }],
      [bounced(), { timestamp: NOW_SECONDS - 3600 }],
      [JSON.stringify({ type: 'email.delivered', data: { to: [ADDRESS] } }), {}],
      [bounced({ to: ['Max Mustermann'] }), {}],
      [`{"type":"email.bounced","to":"${ADDRESS}"`, {}], // unparseable
    ]
    for (const [body, opts] of cases) {
      bodies.push(await (await post(body, makeFake().deps, opts)).text())
    }
    // And the failure paths, which are the ones most tempted to dump context.
    bodies.push(await (await post(bounced(), makeFake({ scanError: { message: 'reset' } }).deps)).text())
    bodies.push(await (await post(bounced(), makeFake({ rpcError: { message: 'denied' } }).deps)).text())
    bodies.push(await (await post(bounced(), makeFake({ throwOnAdmin: true }).deps)).text())
  })

  const needles = [ADDRESS, NORMALIZED, 'example.test', 'Kurz zu unserem Gespräch', 'does not exist']
  for (const line of lines) {
    for (const needle of needles) {
      assert(
        !line.toLowerCase().includes(needle.toLowerCase()),
        `a log line leaked "${needle}": ${line}`,
      )
    }
  }
  for (const body of bodies) {
    for (const needle of needles) {
      assert(
        !body.toLowerCase().includes(needle.toLowerCase()),
        `a response body leaked "${needle}": ${body}`,
      )
    }
  }
  // Sanity: the capture is actually capturing something, so the assertions above
  // are not passing on an empty list.
  assert(lines.length > 0, 'no log lines were captured at all')
})

Deno.test('the handled paths still log something useful: the event type and counts', async () => {
  const { lines } = await withCapturedLogs(async () => {
    await post(bounced(), makeFake().deps)
  })
  assert(lines.some((l) => l.includes('email.bounced')), 'nothing identified the event')
  assert(lines.some((l) => l.includes('suppressed')), 'nothing reported what was written')
})
