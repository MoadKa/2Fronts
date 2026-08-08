import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { type ConsentConfirmDeps, handleConsentConfirm } from './index.ts'
import { signConfirmToken } from '../_shared/consentMail.ts'
import { renderNeutralPage } from '../_shared/consentPage.ts'

const SECRET = 'test-consent-confirm-secret'
const TOKEN = 'AbCdEfGh01234567_-xyzXYZ'
const NOW = new Date('2026-08-08T12:00:00.000Z')

const GRANTED = {
  id: 'consent-1',
  concierge_id: 'conc-1',
  conversation_id: 'conv-1',
  sender_owner_id: 'owner-1',
  visitor_email: 'Visitor@Example.test',
  visitor_email_norm: 'visitor@example.test',
  notice_version: 'concierge-followup-email-v1',
  notice_label: 'Ja, Coach Meier darf mir zu diesem Gespräch eine E-Mail schreiben, auch wenn ich heute keinen Termin buche.',
  notice_text: 'Wir schicken dir gleich eine kurze Bestätigungsmail. [... die vollständige Fassung, wie gerendert ...]',
  rendered_business_name: 'Coach Meier',
  locale: 'de',
  confirm_token_expires_at: '2026-08-09T12:00:00.000Z',
}

interface Query {
  table: string
  columns: string
  filters: Array<[string, unknown]>
}

interface Fake {
  queries: Query[]
  inserts: Record<string, unknown>[]
  adminCalls: number
}

interface FakeOptions {
  granted?: Record<string, unknown> | null
  /** The ledger rows for the subject key. Defaults to the grant alone. */
  ledger?: Array<{ action: string; created_at: string }>
  grantedError?: { code?: string; message: string } | null
  ledgerError?: { code?: string; message: string } | null
  insertError?: { code?: string; message: string } | null
  throwOnAdmin?: boolean
}

// Hand-rolled Supabase client. The two reads differ in their terminal call
// (`.maybeSingle()` for the single granted row, an awaited `.limit()` for the
// ledger), so `limit()` answers a promise that also carries `maybeSingle`.
function makeFake(opts: FakeOptions = {}): { fake: Fake; deps: ConsentConfirmDeps } {
  const fake: Fake = { queries: [], inserts: [], adminCalls: 0 }

  const granted = opts.granted === undefined ? GRANTED : opts.granted
  const ledger = opts.ledger ?? [{ action: 'granted', created_at: '2026-08-08T11:00:00.000Z' }]

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
            order(_column: string, _opts: unknown) {
              return builder
            },
            limit(_n: number) {
              const ledgerResult = Promise.resolve(
                opts.ledgerError ? { data: null, error: opts.ledgerError } : { data: ledger, error: null },
              )
              return Object.assign(ledgerResult, {
                maybeSingle: () =>
                  Promise.resolve(
                    opts.grantedError ? { data: null, error: opts.grantedError } : { data: granted, error: null },
                  ),
              })
            },
          }
          return builder
        },
        insert(row: Record<string, unknown>) {
          fake.inserts.push(row)
          return Promise.resolve({ error: opts.insertError ?? null })
        },
      }
    },
  }

  const deps: ConsentConfirmDeps = {
    createAdminClient: () => {
      fake.adminCalls++
      if (opts.throwOnAdmin) throw new Error('no service role key')
      return client as never
    },
    env: (key) => (key === 'CONSENT_CONFIRM_SECRET' ? SECRET : undefined),
    now: () => NOW,
  }

  return { fake, deps }
}

async function get(t: string | null, deps: ConsentConfirmDeps, init: RequestInit = {}) {
  const url = t === null
    ? 'https://ref.functions.test/concierge-consent-confirm'
    : `https://ref.functions.test/concierge-consent-confirm?t=${encodeURIComponent(t)}`
  return await handleConsentConfirm(new Request(url, { method: 'GET', ...init }), deps)
}

async function signed(): Promise<string> {
  const s = await signConfirmToken(TOKEN, SECRET)
  assert(s)
  return s
}

const NEUTRAL_DE = renderNeutralPage('de')

// --- The happy path ---------------------------------------------------------

Deno.test('a valid token files exactly one confirmed row and renders the success page', async () => {
  const { fake, deps } = makeFake()

  const res = await get(await signed(), deps)
  const body = await res.text()

  assertEquals(res.status, 200)
  assertEquals(fake.inserts.length, 1)
  const row = fake.inserts[0]
  assertEquals(row.action, 'confirmed')
  assertEquals(row.source, 'visitor_confirmation')
  assertEquals(row.channel, 'email')
  assertStringIncludes(body, 'Coach Meier')
  assertStringIncludes(body, '<html lang="de">')
  assertStringIncludes(body, 'bestätigt')
})

Deno.test('the confirmed row carries the granted row\'s wording snapshot verbatim', async () => {
  const { fake, deps } = makeFake()
  await get(await signed(), deps)

  const row = fake.inserts[0]
  // The whole point of the ledger: what the visitor read, not what we would
  // write today.
  assertEquals(row.notice_version, GRANTED.notice_version)
  assertEquals(row.notice_label, GRANTED.notice_label)
  assertEquals(row.notice_text, GRANTED.notice_text)
  assertEquals(row.rendered_business_name, GRANTED.rendered_business_name)
  assertEquals(row.locale, GRANTED.locale)
  // And the subject key, so the ledger resolves to one person.
  assertEquals(row.concierge_id, GRANTED.concierge_id)
  assertEquals(row.conversation_id, GRANTED.conversation_id)
  assertEquals(row.sender_owner_id, GRANTED.sender_owner_id)
  assertEquals(row.visitor_email, GRANTED.visitor_email)
  assertEquals(row.visitor_email_norm, GRANTED.visitor_email_norm)
  // The database owns the time.
  assert(!('created_at' in row))
  // No token is copied into the evidence row.
  assert(!('confirm_token' in row))
})

Deno.test('the click\'s own IP and user agent are recorded, not the grant\'s', async () => {
  const { fake, deps } = makeFake()
  await get(await signed(), deps, {
    headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'MailScanner/2.0' },
  })

  assertEquals(fake.inserts[0].visitor_ip, '203.0.113.9')
  assertEquals(fake.inserts[0].visitor_user_agent, 'MailScanner/2.0')
})

Deno.test('a missing IP or user agent is stored as null, and a long one is clamped', async () => {
  const bare = makeFake()
  await get(await signed(), bare.deps)
  assertEquals(bare.fake.inserts[0].visitor_ip, null)
  assertEquals(bare.fake.inserts[0].visitor_user_agent, null)

  const long = makeFake()
  await get(await signed(), long.deps, { headers: { 'user-agent': 'U'.repeat(900) } })
  assertEquals((long.fake.inserts[0].visitor_user_agent as string).length, 512)
})

Deno.test('the page speaks the language of the stored consent, not the browser\'s', async () => {
  const { deps } = makeFake({ granted: { ...GRANTED, locale: 'en' } })
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
  assertEquals(first.fake.inserts.length, 1)

  // The world after the first click: the ledger now holds a confirmation.
  const second = makeFake({
    ledger: [
      { action: 'confirmed', created_at: '2026-08-08T11:30:00.000Z' },
      { action: 'granted', created_at: '2026-08-08T11:00:00.000Z' },
    ],
  })
  const secondRes = await get(t, second.deps)
  const secondBody = await secondRes.text()

  assertEquals(second.fake.inserts.length, 0, 'a second confirmed row was filed')
  assertEquals(secondRes.status, firstRes.status)
  assertEquals(secondBody, firstBody, 'the second click rendered a different page')
})

Deno.test('a unique violation on insert is a success, not a failure', async () => {
  // What a concurrent prefetch looks like once a partial unique index exists.
  const { fake, deps } = makeFake({ insertError: { code: '23505', message: 'duplicate key' } })
  const res = await get(await signed(), deps)
  const body = await res.text()

  assertEquals(res.status, 200)
  assertEquals(fake.inserts.length, 1)
  assertStringIncludes(body, 'Coach Meier')
  assertEquals(body, await (await get(await signed(), makeFake().deps)).text())
})

// --- The neutral path: no writes, no distinguishing signal ------------------

Deno.test('an unknown token and an expired token render the identical neutral page', async () => {
  const unknown = makeFake({ granted: null })
  const unknownRes = await get(await signed(), unknown.deps)
  const unknownBody = await unknownRes.text()

  const expired = makeFake({ granted: { ...GRANTED, confirm_token_expires_at: '2026-08-08T11:59:59.000Z' } })
  const expiredRes = await get(await signed(), expired.deps)
  const expiredBody = await expiredRes.text()

  assertEquals(unknownBody, expiredBody, 'unknown and expired are distinguishable')
  assertEquals(unknownBody, NEUTRAL_DE)
  assertEquals(unknownRes.status, expiredRes.status)
  assertEquals(unknownRes.status, 200)
  assertEquals(unknown.fake.inserts.length, 0)
  assertEquals(expired.fake.inserts.length, 0)
})

Deno.test('an expired token stops after the one lookup: no ledger read, no write', async () => {
  const { fake, deps } = makeFake({ granted: { ...GRANTED, confirm_token_expires_at: '2020-01-01T00:00:00.000Z' } })
  await get(await signed(), deps)

  assertEquals(fake.queries.length, 1, 'the expired path made a second read')
  assertEquals(fake.queries[0].filters[0][0], 'confirm_token')
  assertEquals(fake.inserts.length, 0)
})

Deno.test('an unparseable expiry is treated as expired', async () => {
  const { fake, deps } = makeFake({ granted: { ...GRANTED, confirm_token_expires_at: 'not a timestamp' } })
  const res = await get(await signed(), deps)
  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.inserts.length, 0)
})

Deno.test('a null expiry is not treated as expired', async () => {
  const { fake, deps } = makeFake({ granted: { ...GRANTED, confirm_token_expires_at: null } })
  await get(await signed(), deps)
  assertEquals(fake.inserts.length, 1)
})

Deno.test('the lookup asks for the granted row of that exact token', async () => {
  const { fake, deps } = makeFake()
  await get(await signed(), deps)

  assertEquals(fake.queries[0].table, 'concierge_consents')
  assertEquals(fake.queries[0].filters, [['confirm_token', TOKEN], ['action', 'granted']])
  // The snapshot columns the confirmed row is built from.
  for (const column of ['notice_version', 'notice_label', 'notice_text', 'rendered_business_name', 'locale']) {
    assertStringIncludes(fake.queries[0].columns, column)
  }
})

// --- Nothing reaches the database without a valid signature -----------------

Deno.test('a forged, truncated or absent token never constructs a client', async () => {
  const t = await signed()
  const [token, sig] = t.split('.')

  const cases: Array<string | null> = [
    null, // no t at all
    '', // empty
    token, // token without a signature
    `${token}.${sig.slice(0, -1)}A`, // tampered signature
    `${token}X.${sig}`, // tampered token
    `${'A'.repeat(400)}.${sig}`, // oversized
    'nonsense',
    `${token}.${sig}.extra`,
  ]

  for (const value of cases) {
    const { fake, deps } = makeFake()
    const res = await get(value, deps)
    assertEquals(await res.text(), NEUTRAL_DE, `case ${value}`)
    assertEquals(res.status, 200)
    assertEquals(fake.adminCalls, 0, `case ${value} touched the database`)
    assertEquals(fake.queries.length, 0)
    assertEquals(fake.inserts.length, 0)
  }
})

Deno.test('a token signed with a different secret is refused before any read', async () => {
  const foreign = await signConfirmToken(TOKEN, 'someone-elses-secret')
  assert(foreign)
  const { fake, deps } = makeFake()
  const res = await get(foreign, deps)

  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.adminCalls, 0)
})

Deno.test('a missing CONSENT_CONFIRM_SECRET fails closed without touching the database', async () => {
  const { fake, deps } = makeFake()
  const res = await get(await signed(), { ...deps, env: () => undefined })

  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.adminCalls, 0)
})

// --- Refusals that protect the visitor --------------------------------------

Deno.test('a withdrawal is never overwritten by an old confirm link', async () => {
  const { fake, deps } = makeFake({
    ledger: [
      { action: 'withdrawn', created_at: '2026-08-08T11:45:00.000Z' },
      { action: 'granted', created_at: '2026-08-08T11:00:00.000Z' },
    ],
  })
  const res = await get(await signed(), deps)

  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.inserts.length, 0, 'a withdrawn consent was resurrected')
})

Deno.test('an empty ledger (no live grant behind the token) writes nothing', async () => {
  const { fake, deps } = makeFake({ ledger: [] })
  const res = await get(await signed(), deps)
  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.inserts.length, 0)
})

// --- Failures never become a false success ---------------------------------

Deno.test('a failing lookup, ledger read or insert renders the neutral page, never a lie', async () => {
  const lookup = makeFake({ grantedError: { message: 'connection reset' } })
  assertEquals(await (await get(await signed(), lookup.deps)).text(), NEUTRAL_DE)
  assertEquals(lookup.fake.inserts.length, 0)

  const ledger = makeFake({ ledgerError: { message: 'connection reset' } })
  assertEquals(await (await get(await signed(), ledger.deps)).text(), NEUTRAL_DE)
  assertEquals(ledger.fake.inserts.length, 0)

  const insert = makeFake({ insertError: { code: '23514', message: 'check constraint' } })
  assertEquals(await (await get(await signed(), insert.deps)).text(), NEUTRAL_DE)
})

Deno.test('an admin client that throws is answered with a page, not a stack trace', async () => {
  const { deps } = makeFake({ throwOnAdmin: true })
  const res = await get(await signed(), deps)
  assertEquals(res.status, 200)
  assertEquals(await res.text(), NEUTRAL_DE)
})

Deno.test('a deps object that throws on every call still returns a Response', async () => {
  const hostile: ConsentConfirmDeps = {
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
  const res = await handleConsentConfirm(
    new Request('https://ref.functions.test/concierge-consent-confirm?t=x.y'),
    hostile,
  )
  assertEquals(res.status, 200)
  assertEquals(await res.text(), NEUTRAL_DE)
})

// --- Method, headers, language ---------------------------------------------

Deno.test('a POST is refused with the neutral page and no database access', async () => {
  const { fake, deps } = makeFake()
  const res = await handleConsentConfirm(
    new Request(`https://ref.functions.test/concierge-consent-confirm?t=${await signed()}`, { method: 'POST' }),
    deps,
  )
  assertEquals(res.status, 405)
  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.adminCalls, 0)
})

Deno.test('HEAD is treated as a read, like GET', async () => {
  const { fake, deps } = makeFake()
  const res = await handleConsentConfirm(
    new Request(`https://ref.functions.test/concierge-consent-confirm?t=${await signed()}`, { method: 'HEAD' }),
    deps,
  )
  assertEquals(res.status, 200)
  assertEquals(fake.inserts.length, 1)
})

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

Deno.test('the neutral page follows the browser language when we have no row to ask', async () => {
  const { deps } = makeFake({ granted: null })
  const res = await get(await signed(), deps, { headers: { 'accept-language': 'en-GB,en;q=0.9' } })
  assertStringIncludes(await res.text(), '<html lang="en">')
})

Deno.test('no response body ever contains an external URL', async () => {
  const ok = await (await get(await signed(), makeFake().deps)).text()
  const neutral = await (await get('garbage', makeFake().deps)).text()
  for (const body of [ok, neutral]) {
    assert(!body.includes('http://'))
    assert(!body.includes('https://'))
  }
})
