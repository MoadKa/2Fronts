import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { handleVerifyReplyTo, type VerifyReplyToDeps } from './index.ts'
import { signReplyToVerifyToken } from '../_shared/replyToVerifyMail.ts'
import { renderReplyToVerifyNeutralPage } from '../_shared/replyToVerifyPage.ts'

const SECRET = 'test-reply-to-verify-secret'
const CONCIERGE_ID = '11111111-2222-4333-8444-555555555555'
const OTHER_ID = '99999999-8888-4777-8666-555555555555'
const REPLY_TO = 'hallo@acme.de'
const OTHER_REPLY_TO = 'anders@acme.de'
const NOW = new Date('2026-08-08T12:00:00.000Z')

const ROW = {
  id: CONCIERGE_ID,
  business_name: 'Coach Meier',
  language: 'de',
  followup_reply_to: REPLY_TO,
  followup_reply_to_verified_at: null as string | null,
}

interface Query {
  table: string
  columns: string
  filters: Array<[string, unknown]>
}

interface Update {
  table: string
  patch: Record<string, unknown>
  filters: Array<[string, unknown]>
}

interface Fake {
  queries: Query[]
  updates: Update[]
  adminCalls: number
}

interface FakeOptions {
  row?: Record<string, unknown> | null
  readError?: { message: string } | null
  updateError?: { message: string } | null
  /** What the compare-and-set update matched. Empty models the address race. */
  updatedRows?: { id: string }[]
  throwOnAdmin?: boolean
}

// Hand-rolled Supabase client, in the shape concierge-consent-confirm's test
// uses: one read that ends in .maybeSingle(), one update that ends in .select().
function makeFake(opts: FakeOptions = {}): { fake: Fake; deps: VerifyReplyToDeps } {
  const fake: Fake = { queries: [], updates: [], adminCalls: 0 }
  const row = opts.row === undefined ? ROW : opts.row

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const query: Query = { table, columns, filters: [] }
          fake.queries.push(query)
          const builder = {
            eq(column: string, value: unknown) {
              query.filters.push([column, value])
              return builder
            },
            maybeSingle: () =>
              Promise.resolve(
                opts.readError ? { data: null, error: opts.readError } : { data: row, error: null },
              ),
          }
          return builder
        },
        update(patch: Record<string, unknown>) {
          const update: Update = { table, patch, filters: [] }
          fake.updates.push(update)
          const builder = {
            eq(column: string, value: unknown) {
              update.filters.push([column, value])
              return builder
            },
            select: () =>
              Promise.resolve(
                opts.updateError
                  ? { data: null, error: opts.updateError }
                  : { data: opts.updatedRows ?? [{ id: CONCIERGE_ID }], error: null },
              ),
          }
          return builder
        },
      }
    },
  }

  const deps: VerifyReplyToDeps = {
    createAdminClient: () => {
      fake.adminCalls++
      if (opts.throwOnAdmin) throw new Error('no service role key')
      return client as never
    },
    env: (key) => (key === 'FOLLOWUP_REPLY_TO_SECRET' ? SECRET : undefined),
    now: () => NOW,
  }

  return { fake, deps }
}

async function get(t: string | null, deps: VerifyReplyToDeps, init: RequestInit = {}) {
  const url = t === null
    ? 'https://ref.functions.test/concierge-followup-verify-reply-to'
    : `https://ref.functions.test/concierge-followup-verify-reply-to?t=${encodeURIComponent(t)}`
  return await handleVerifyReplyTo(new Request(url, { method: 'GET', ...init }), deps)
}

async function signed(conciergeId = CONCIERGE_ID, address = REPLY_TO): Promise<string> {
  const t = await signReplyToVerifyToken(conciergeId, address, SECRET)
  assert(t)
  return t
}

const NEUTRAL_DE = renderReplyToVerifyNeutralPage('de')

// --- The happy path ---------------------------------------------------------

Deno.test('a valid token stamps followup_reply_to_verified_at exactly once', async () => {
  const { fake, deps } = makeFake()

  const res = await get(await signed(), deps)
  const body = await res.text()

  assertEquals(res.status, 200)
  assertEquals(fake.updates.length, 1)
  const update = fake.updates[0]
  assertEquals(update.table, 'concierges')
  assertEquals(Object.keys(update.patch), ['followup_reply_to_verified_at'])
  assertEquals(update.patch.followup_reply_to_verified_at, NOW.toISOString())
  assertStringIncludes(body, 'Coach Meier')
  assertStringIncludes(body, '<html lang="de">')
  assertStringIncludes(body, 'bestätigt')
})

Deno.test('the stamp is a compare-and-set on the id AND the address it verified', async () => {
  const { fake, deps } = makeFake()
  await get(await signed(), deps)

  // The read asks for exactly this concierge.
  assertEquals(fake.queries[0].table, 'concierges')
  assertEquals(fake.queries[0].filters, [['id', CONCIERGE_ID]])
  // The write cannot land on a row whose address changed under us.
  assertEquals(fake.updates[0].filters, [['id', CONCIERGE_ID], ['followup_reply_to', REPLY_TO]])
})

Deno.test('a save landing between the read and the write verifies nothing', async () => {
  // The compare-and-set matched no row: the address changed in the meantime.
  const { fake, deps } = makeFake({ updatedRows: [] })
  const res = await get(await signed(), deps)
  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.updates.length, 1, 'the update was attempted')
})

Deno.test('the page speaks the concierge language, not the browser one', async () => {
  const { deps } = makeFake({ row: { ...ROW, language: 'en' } })
  const res = await get(await signed(), deps, { headers: { 'accept-language': 'de-DE,de;q=0.9' } })
  const body = await res.text()
  assertStringIncludes(body, '<html lang="en">')
  assertStringIncludes(body, 'confirmed')
})

// --- Idempotency ------------------------------------------------------------

Deno.test('a second click writes nothing and renders the identical page', async () => {
  const t = await signed()

  const first = makeFake()
  const firstRes = await get(t, first.deps)
  const firstBody = await firstRes.text()
  assertEquals(first.fake.updates.length, 1)

  // The world after the first click.
  const second = makeFake({
    row: { ...ROW, followup_reply_to_verified_at: '2026-08-08T11:00:00.000Z' },
  })
  const secondRes = await get(t, second.deps)
  const secondBody = await secondRes.text()

  assertEquals(second.fake.updates.length, 0, 'a second stamp was written')
  assertEquals(secondRes.status, firstRes.status)
  assertEquals(secondBody, firstBody, 'the second click rendered a different page')
})

// --- The address binding ----------------------------------------------------

Deno.test('a token for a DIFFERENT address than the row now holds does NOT verify', async () => {
  // The mail went to OTHER_REPLY_TO; the coach has since saved REPLY_TO.
  const { fake, deps } = makeFake()
  const res = await get(await signed(CONCIERGE_ID, OTHER_REPLY_TO), deps)

  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.updates.length, 0, 'a verification was inherited by a changed address')
  // It cost one read and no write.
  assertEquals(fake.queries.length, 1)
})

Deno.test('the same address in different case or with padding still verifies', async () => {
  const { fake, deps } = makeFake({ row: { ...ROW, followup_reply_to: '  Hallo@Acme.DE ' } })
  const res = await get(await signed(CONCIERGE_ID, REPLY_TO), deps)
  assertEquals(res.status, 200)
  assertEquals(fake.updates.length, 1)
  await res.body?.cancel()
})

Deno.test('a token for another concierge cannot stamp this one', async () => {
  // Signed correctly, but for a different setter: the read finds that setter's
  // row (here, none) and nothing is written.
  const { fake, deps } = makeFake({ row: null })
  const res = await get(await signed(OTHER_ID, REPLY_TO), deps)
  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.updates.length, 0)
  assertEquals(fake.queries[0].filters, [['id', OTHER_ID]])
})

Deno.test('a row with no reply-to at all is never verified', async () => {
  for (const value of [null, '', '   ']) {
    const { fake, deps } = makeFake({ row: { ...ROW, followup_reply_to: value } })
    const res = await get(await signed(), deps)
    assertEquals(await res.text(), NEUTRAL_DE, `reply_to ${JSON.stringify(value)}`)
    assertEquals(fake.updates.length, 0)
  }
})

// --- Nothing reaches the database without a valid signature -----------------

Deno.test('a forged, truncated or absent token never constructs a client', async () => {
  const t = await signed()
  const [version, id, digest, sig] = t.split('.')

  const cases: Array<string | null> = [
    null, // no t at all
    '', // empty
    `${version}.${id}.${digest}`, // no signature
    `${version}.${id}.${digest}.${sig.slice(0, -1)}A`, // tampered signature
    `${version}.${OTHER_ID}.${digest}.${sig}`, // another id under our signature
    `${version}.${id}.${'A'.repeat(43)}.${sig}`, // swapped digest
    `v2.${id}.${digest}.${sig}`, // unknown version
    `${'A'.repeat(400)}.${sig}`, // oversized
    'nonsense',
    `${t}.extra`,
  ]

  for (const value of cases) {
    const { fake, deps } = makeFake()
    const res = await get(value, deps)
    assertEquals(await res.text(), NEUTRAL_DE, `case ${value}`)
    assertEquals(res.status, 200)
    assertEquals(fake.adminCalls, 0, `case ${value} touched the database`)
    assertEquals(fake.queries.length, 0)
    assertEquals(fake.updates.length, 0)
  }
})

Deno.test('a token signed with a different secret is refused before any read', async () => {
  const foreign = await signReplyToVerifyToken(CONCIERGE_ID, REPLY_TO, 'someone-elses-secret')
  assert(foreign)
  const { fake, deps } = makeFake()
  const res = await get(foreign, deps)

  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.adminCalls, 0)
})

Deno.test('a missing FOLLOWUP_REPLY_TO_SECRET fails closed without touching the database', async () => {
  const { fake, deps } = makeFake()
  const res = await get(await signed(), { ...deps, env: () => undefined })

  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.adminCalls, 0)
})

// --- Method discipline ------------------------------------------------------

// HEAD MUST NOT VERIFY. Outlook Safe Links, Proofpoint and Mimecast issue HEAD
// against every URL in an inbound mail as a matter of course. GET is accepted
// despite the same prefetch risk, because a human clicking really does produce
// a GET; no browser navigation emits HEAD.
Deno.test('HEAD answers a page but NEVER verifies, and does not even look the token up', async () => {
  const { fake, deps } = makeFake()
  const res = await handleVerifyReplyTo(
    new Request(`https://ref.functions.test/x?t=${await signed()}`, { method: 'HEAD' }),
    deps,
  )
  assertEquals(res.status, 200)
  assertEquals(fake.updates.length, 0)
  assertEquals(fake.queries.length, 0)
  assertEquals(fake.adminCalls, 0)
  await res.body?.cancel()
})

Deno.test('a POST is refused with the neutral page and no database access', async () => {
  const { fake, deps } = makeFake()
  const res = await handleVerifyReplyTo(
    new Request(`https://ref.functions.test/x?t=${await signed()}`, { method: 'POST' }),
    deps,
  )
  assertEquals(res.status, 405)
  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.adminCalls, 0)
})

// --- Failures never become a false success ---------------------------------

Deno.test('a failing read or a failing stamp renders the neutral page, never a lie', async () => {
  const read = makeFake({ readError: { message: 'connection reset' } })
  assertEquals(await (await get(await signed(), read.deps)).text(), NEUTRAL_DE)
  assertEquals(read.fake.updates.length, 0)

  const write = makeFake({ updateError: { message: 'connection reset' } })
  assertEquals(await (await get(await signed(), write.deps)).text(), NEUTRAL_DE)
})

Deno.test('an admin client that throws is answered with a page, not a stack trace', async () => {
  const { deps } = makeFake({ throwOnAdmin: true })
  const res = await get(await signed(), deps)
  assertEquals(res.status, 200)
  assertEquals(await res.text(), NEUTRAL_DE)
})

Deno.test('a deps object that throws on every call still returns a Response', async () => {
  const hostile: VerifyReplyToDeps = {
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
  const res = await handleVerifyReplyTo(
    new Request('https://ref.functions.test/x?t=v1.a.b.c'),
    hostile,
  )
  assertEquals(res.status, 200)
  assertEquals(await res.text(), NEUTRAL_DE)
})

// --- Headers and the pages themselves ---------------------------------------

Deno.test('every response carries the noindex, no-referrer and no-store headers', async () => {
  const ok = await get(await signed(), makeFake().deps)
  const bad = await get('garbage', makeFake().deps)

  for (const res of [ok, bad]) {
    assertEquals(res.headers.get('X-Robots-Tag'), 'noindex, nofollow')
    assertEquals(res.headers.get('Referrer-Policy'), 'no-referrer')
    assertStringIncludes(res.headers.get('Cache-Control') ?? '', 'no-store')
    assertStringIncludes(res.headers.get('Content-Security-Policy') ?? '', "default-src 'none'")
    assertStringIncludes(res.headers.get('Content-Type') ?? '', 'text/html')
    await res.body?.cancel()
  }
})

Deno.test('no response body ever contains an external URL or the address', async () => {
  const ok = await (await get(await signed(), makeFake().deps)).text()
  const neutral = await (await get('garbage', makeFake().deps)).text()
  for (const body of [ok, neutral]) {
    assert(!body.includes('http://'))
    assert(!body.includes('https://'))
    assert(!body.includes(REPLY_TO))
  }
})

Deno.test('the neutral page follows the browser language when we have no row to ask', async () => {
  const { deps } = makeFake({ row: null })
  const res = await get(await signed(), deps, { headers: { 'accept-language': 'en-GB,en;q=0.9' } })
  assertStringIncludes(await res.text(), '<html lang="en">')
})

Deno.test('every failure renders the byte-identical neutral page', async () => {
  const bodies = await Promise.all([
    get('garbage', makeFake().deps),
    get(await signed(), makeFake({ row: null }).deps),
    get(await signed(CONCIERGE_ID, OTHER_REPLY_TO), makeFake().deps),
    get(await signed(), makeFake({ readError: { message: 'down' } }).deps),
    get(await signed(), makeFake({ updateError: { message: 'down' } }).deps),
  ].map(async (p) => await (await p).text()))

  for (const body of bodies) assertEquals(body, NEUTRAL_DE)
})
