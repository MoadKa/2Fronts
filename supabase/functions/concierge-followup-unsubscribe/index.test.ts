import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  type FollowupUnsubscribeDeps,
  handleFollowupUnsubscribe,
  UNSUBSCRIBE_RPC,
  UNSUBSCRIBE_UNDO_RPC,
} from './index.ts'
import { signUnsubscribeToken } from '../_shared/followupToken.ts'
import { renderUnsubscribeNeutralPage } from '../_shared/followupPage.ts'
import { FOLLOWUP_PAGE_CSP } from '../_shared/followupPage.ts'

const SECRET = 'test-followup-unsub-secret'
const PREVIOUS = 'test-followup-unsub-secret-previous'
const CONCIERGE = '11111111-2222-4333-8444-555555555555'
const CONVERSATION = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const PATH = 'https://ref.functions.test/concierge-followup-unsubscribe'

const IDENTITY = {
  visitor_email_norm: 'visitor@example.test',
  locale: 'de',
  rendered_business_name: 'Coach Meier',
}

interface Query {
  table: string
  columns: string
  filters: Array<[string, unknown]>
}

interface RpcCall {
  name: string
  args: Record<string, unknown>
}

interface Fake {
  queries: Query[]
  rpcs: RpcCall[]
  adminCalls: number
  /** Anything that would be a write outside the RPC. Must stay empty. */
  writes: string[]
}

interface FakeOptions {
  identity?: Record<string, unknown> | null
  lookupError?: { message: string } | null
  rpcError?: { message: string } | null
  throwOnAdmin?: boolean
  env?: Record<string, string | undefined>
}

// Hand-rolled Supabase client, same shape as concierge-consent-confirm's.
// `update` and `delete` are present and THROW: the suppression is the RPC's
// job, and a future edit that reaches for a joined UPDATE here fails loudly
// rather than silently writing through a filter we did not audit.
function makeFake(opts: FakeOptions = {}): { fake: Fake; deps: FollowupUnsubscribeDeps } {
  const fake: Fake = { queries: [], rpcs: [], adminCalls: 0, writes: [] }
  const identity = opts.identity === undefined ? IDENTITY : opts.identity

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
            order(_column: string, _o: unknown) {
              return builder
            },
            limit(_n: number) {
              return {
                maybeSingle: () =>
                  Promise.resolve(
                    opts.lookupError
                      ? { data: null, error: opts.lookupError }
                      : { data: identity, error: null },
                  ),
              }
            },
          }
          return builder
        },
        update(_row: unknown) {
          fake.writes.push(`update:${table}`)
          throw new Error('the endpoint must not UPDATE; the RPC owns the write')
        },
        delete() {
          fake.writes.push(`delete:${table}`)
          throw new Error('the endpoint must not DELETE; the RPC owns the write')
        },
        insert(_row: unknown) {
          fake.writes.push(`insert:${table}`)
          throw new Error('the endpoint must not INSERT; the RPC owns the write')
        },
      }
    },
    rpc(name: string, args: Record<string, unknown>) {
      fake.rpcs.push({ name, args })
      return Promise.resolve({ data: null, error: opts.rpcError ?? null })
    },
  }

  const env = opts.env ?? { FOLLOWUP_UNSUB_SECRET: SECRET }
  const deps: FollowupUnsubscribeDeps = {
    createAdminClient: () => {
      fake.adminCalls++
      if (opts.throwOnAdmin) throw new Error('no service role key')
      return client as never
    },
    env: (key) => env[key],
  }
  return { fake, deps }
}

async function signed(secret = SECRET): Promise<string> {
  const t = await signUnsubscribeToken(CONCIERGE, CONVERSATION, secret)
  assert(t)
  return t
}

function urlFor(t: string | null, extra = ''): string {
  if (t === null) return `${PATH}${extra ? `?${extra.replace(/^&/, '')}` : ''}`
  return `${PATH}?t=${encodeURIComponent(t)}${extra}`
}

async function call(
  method: string,
  t: string | null,
  deps: FollowupUnsubscribeDeps,
  extra = '',
  init: RequestInit = {},
) {
  return await handleFollowupUnsubscribe(new Request(urlFor(t, extra), { method, ...init }), deps)
}

const NEUTRAL_DE = renderUnsubscribeNeutralPage('de')

// --- The GET path -----------------------------------------------------------

Deno.test('GET calls the unsubscribe RPC with the resolved address and never attempts a joined UPDATE', async () => {
  const { fake, deps } = makeFake()
  const res = await call('GET', await signed(), deps)

  assertEquals(res.status, 200)
  assertEquals(fake.rpcs.length, 1)
  assertEquals(fake.rpcs[0].name, UNSUBSCRIBE_RPC)
  assertEquals(fake.rpcs[0].args, {
    p_concierge_id: CONCIERGE,
    p_email: IDENTITY.visitor_email_norm,
    p_source: 'visitor_unsubscribe',
  })

  // No UPDATE, no DELETE, no INSERT: the fake throws on all three, and this
  // asserts none of them was even reached.
  assertEquals(fake.writes, [])

  // Exactly one read, and it is the identity lookup.
  assertEquals(fake.queries.length, 1)
  assertEquals(fake.queries[0].table, 'concierge_consents')

  const html = await res.text()
  assertStringIncludes(html, 'Du bekommst keine E-Mail mehr von Coach Meier.')
})

Deno.test('the address never reaches a PostgREST filter', async () => {
  // isEmail() upstream permits `,`, `(` and `)`, which are PostgREST syntax. An
  // address in a filter string is therefore a crafted address reading or
  // deleting other people's rows. Every filter here must be a UUID.
  const { fake, deps } = makeFake()
  await call('GET', await signed(), deps)

  const values = fake.queries.flatMap((q) => q.filters.map(([, v]) => String(v)))
  assertEquals(values.sort(), [CONCIERGE, CONVERSATION].sort())
  for (const v of values) {
    assert(!v.includes('@'), `an address reached a filter: ${v}`)
    assert(/^[0-9a-fA-F-]+$/.test(v), `a non-UUID reached a filter: ${v}`)
  }
  // The address only ever travels as a bound RPC argument.
  assertEquals(fake.rpcs[0].args.p_email, IDENTITY.visitor_email_norm)
})

Deno.test('GET acts on a prefetch: there is no second click to make', async () => {
  // Mail clients and link scanners fetch every URL in an inbound mail. Here the
  // misfire direction is "no mail is sent", so GET writes. (The confirm
  // endpoint refuses HEAD for the opposite reason: there a prefetch would
  // fabricate a consent.) HEAD acts too, and carries no body.
  const { fake, deps } = makeFake()
  const res = await call('HEAD', await signed(), deps)
  assertEquals(res.status, 200)
  assertEquals(await res.text(), '')
  assertEquals(fake.rpcs.length, 1)
  assertEquals(fake.rpcs[0].name, UNSUBSCRIBE_RPC)
})

Deno.test('the unsubscribed page offers the undo as a POST form on this same path', async () => {
  const { deps } = makeFake()
  const res = await call('GET', await signed(), deps)
  const html = await res.text()
  assertStringIncludes(html, '<form method="post"')
  assertStringIncludes(html, 'undo=1')
  assertStringIncludes(html, '/concierge-followup-unsubscribe?t=')
  // Relative: the form must stay on whatever host served the page.
  assert(!html.includes('action="http'), 'the undo form must not carry an absolute URL')
})

// --- RFC 8058 One-Click -----------------------------------------------------

Deno.test('POST List-Unsubscribe=One-Click unsubscribes and shows no form', async () => {
  const { fake, deps } = makeFake()
  const res = await handleFollowupUnsubscribe(
    new Request(urlFor(await signed()), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    }),
    deps,
  )
  assertEquals(res.status, 200)
  assertEquals(fake.rpcs.length, 1)
  assertEquals(fake.rpcs[0].name, UNSUBSCRIBE_RPC)
  // A mail provider made this request; no human is reading the response, and an
  // undo form in it could only ever be submitted by that provider.
  const html = await res.text()
  assert(!html.includes('<form'), 'a One-Click POST must not be answered with a form')
})

// --- Undo -------------------------------------------------------------------

Deno.test('POST undo=1 removes the suppression', async () => {
  const { fake, deps } = makeFake()
  const res = await call('POST', await signed(), deps, '&undo=1')

  assertEquals(res.status, 200)
  assertEquals(fake.rpcs.length, 1)
  assertEquals(fake.rpcs[0].name, UNSUBSCRIBE_UNDO_RPC)
  // No p_source: an undo files no consent and asserts nothing about who the
  // recipient is.
  assertEquals(fake.rpcs[0].args, {
    p_concierge_id: CONCIERGE,
    p_email: IDENTITY.visitor_email_norm,
  })
  assertEquals(fake.writes, [])
  assertStringIncludes(await res.text(), 'Deine Abmeldung ist zurückgenommen.')
})

Deno.test('GET undo=1 unsubscribes, it does NOT undo', async () => {
  // The dangerous direction must not be prefetchable: a GET undo would be
  // followed by the same scanners we deliberately let trigger the unsubscribe,
  // and mail we were told to stop sending would resume on its own.
  const { fake, deps } = makeFake()
  await call('GET', await signed(), deps, '&undo=1')
  assertEquals(fake.rpcs.length, 1)
  assertEquals(fake.rpcs[0].name, UNSUBSCRIBE_RPC)
})

Deno.test('an undo whose RPC fails leaves the suppression standing', async () => {
  const { fake, deps } = makeFake({ rpcError: { message: 'function does not exist' } })
  const res = await call('POST', await signed(), deps, '&undo=1')
  assertEquals(fake.rpcs.length, 1)
  assertEquals(await res.text(), NEUTRAL_DE)
})

// --- Secret rotation --------------------------------------------------------

Deno.test('a link signed under the PREVIOUS secret still works after a rotation', async () => {
  const { fake, deps } = makeFake({
    env: { FOLLOWUP_UNSUB_SECRET: SECRET, FOLLOWUP_UNSUB_SECRET_PREVIOUS: PREVIOUS },
  })
  const res = await call('GET', await signed(PREVIOUS), deps)
  assertEquals(res.status, 200)
  assertEquals(fake.rpcs.length, 1)
})

Deno.test('the same link dies when the previous secret is not configured', async () => {
  const { fake, deps } = makeFake({ env: { FOLLOWUP_UNSUB_SECRET: SECRET } })
  const res = await call('GET', await signed(PREVIOUS), deps)
  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.adminCalls, 0)
})

// --- Fail closed, and quietly -----------------------------------------------

Deno.test('a forged signature constructs no admin client at all', async () => {
  const { fake, deps } = makeFake()
  const good = await signed()
  const forged = `${good.slice(0, good.length - 1)}${good.endsWith('A') ? 'B' : 'A'}`

  const res = await call('GET', forged, deps)
  assertEquals(res.status, 200)
  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.adminCalls, 0)
  assertEquals(fake.queries, [])
  assertEquals(fake.rpcs, [])
})

Deno.test('a token without the v1. prefix returns the neutral page and touches nothing', async () => {
  const { fake, deps } = makeFake()
  const good = await signed()
  const withoutPrefix = good.slice('v1.'.length)

  const res = await call('GET', withoutPrefix, deps)
  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.adminCalls, 0)
  assertEquals(fake.queries, [])
  assertEquals(fake.rpcs, [])
})

Deno.test('a missing token, a missing secret and an unusable admin client all answer the same page', async () => {
  const noToken = makeFake()
  assertEquals(await (await call('GET', null, noToken.deps)).text(), NEUTRAL_DE)
  assertEquals(noToken.fake.adminCalls, 0)

  const noSecret = makeFake({ env: {} })
  assertEquals(await (await call('GET', await signed(), noSecret.deps)).text(), NEUTRAL_DE)
  assertEquals(noSecret.fake.adminCalls, 0)

  const noAdmin = makeFake({ throwOnAdmin: true })
  assertEquals(await (await call('GET', await signed(), noAdmin.deps)).text(), NEUTRAL_DE)
  assertEquals(noAdmin.fake.rpcs, [])
})

Deno.test('a lookup that finds nothing, or errors, never calls the RPC', async () => {
  const none = makeFake({ identity: null })
  assertEquals(await (await call('GET', await signed(), none.deps)).text(), NEUTRAL_DE)
  assertEquals(none.fake.rpcs, [])

  const broken = makeFake({ lookupError: { message: 'connection reset' } })
  assertEquals(await (await call('GET', await signed(), broken.deps)).text(), NEUTRAL_DE)
  assertEquals(broken.fake.rpcs, [])

  const blank = makeFake({ identity: { ...IDENTITY, visitor_email_norm: '  ' } })
  assertEquals(await (await call('GET', await signed(), blank.deps)).text(), NEUTRAL_DE)
  assertEquals(blank.fake.rpcs, [])
})

Deno.test('an unsubscribe whose RPC fails never claims a withdrawal it did not record', async () => {
  const { deps } = makeFake({ rpcError: { message: 'deadlock detected' } })
  const res = await call('GET', await signed(), deps)
  assertEquals(await res.text(), NEUTRAL_DE)
})

Deno.test('an unsupported method is refused with the neutral page', async () => {
  const { fake, deps } = makeFake()
  const res = await call('DELETE', await signed(), deps)
  assertEquals(res.status, 405)
  assertEquals(await res.text(), NEUTRAL_DE)
  assertEquals(fake.adminCalls, 0)
})

Deno.test('the neutral page is byte-identical whatever went wrong', async () => {
  const bodies: string[] = []
  for (
    const fixture of [
      makeFake({ identity: null }),
      makeFake({ lookupError: { message: 'x' } }),
      makeFake({ rpcError: { message: 'y' } }),
      makeFake({ throwOnAdmin: true }),
    ]
  ) {
    bodies.push(await (await call('GET', await signed(), fixture.deps)).text())
  }
  for (const b of bodies) assertEquals(b, bodies[0])
})

// --- The page itself --------------------------------------------------------

Deno.test('every response sets lang, noindex, a CSP, and references no external host', async () => {
  const { deps } = makeFake()
  const responses = [
    await call('GET', await signed(), deps),
    await call('POST', await signed(), deps, '&undo=1'),
    await call('GET', 'garbage', deps),
  ]

  for (const res of responses) {
    assertEquals(res.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assertEquals(res.headers.get('X-Robots-Tag'), 'noindex, nofollow')
    assertEquals(res.headers.get('Referrer-Policy'), 'no-referrer')
    assertEquals(res.headers.get('X-Content-Type-Options'), 'nosniff')
    assertEquals(res.headers.get('Cache-Control'), 'no-store, max-age=0')
    assertEquals(res.headers.get('Content-Security-Policy'), FOLLOWUP_PAGE_CSP)

    const html = await res.text()
    assertStringIncludes(html, '<html lang="de">')
    assertStringIncludes(html, '<meta name="robots" content="noindex, nofollow">')
    assertStringIncludes(html, '<meta name="referrer" content="no-referrer">')

    // No external host, in any form.
    assert(!html.includes('http://'), 'an http URL reached the page')
    assert(!html.includes('https://'), 'an https URL reached the page')
    assert(!/\ssrc=/.test(html), 'a src attribute reached the page')
    assert(!html.includes('@import'), 'an @import reached the page')
    assert(!html.includes('url('), 'a css url() reached the page')
    assert(!html.includes('<script'), 'a script element reached the page')
    assert(!html.includes('<link'), 'a link element reached the page')
    assert(!html.includes('<img'), 'an img element reached the page')
    assert(!html.includes('@font-face'), 'a webfont reached the page')
  }
})

Deno.test('the CSP forbids everything and re-allows only inline style and a form back to us', async () => {
  assertStringIncludes(FOLLOWUP_PAGE_CSP, "default-src 'none'")
  assertStringIncludes(FOLLOWUP_PAGE_CSP, "script-src 'none'")
  assertStringIncludes(FOLLOWUP_PAGE_CSP, "img-src 'none'")
  assertStringIncludes(FOLLOWUP_PAGE_CSP, "font-src 'none'")
  assertStringIncludes(FOLLOWUP_PAGE_CSP, "connect-src 'none'")
  assertStringIncludes(FOLLOWUP_PAGE_CSP, "frame-ancestors 'none'")
  assertStringIncludes(FOLLOWUP_PAGE_CSP, "base-uri 'none'")
  assertStringIncludes(FOLLOWUP_PAGE_CSP, "style-src 'unsafe-inline'")
  // The one relaxation the confirm endpoint does not need: the undo form.
  assertStringIncludes(FOLLOWUP_PAGE_CSP, "form-action 'self'")
  assert(!FOLLOWUP_PAGE_CSP.includes("script-src 'unsafe-inline'"))
})

Deno.test('the page speaks the language of the consent, not of the browser', async () => {
  const { deps } = makeFake({ identity: { ...IDENTITY, locale: 'en' } })
  const res = await handleFollowupUnsubscribe(
    new Request(urlFor(await signed()), { method: 'GET', headers: { 'accept-language': 'de-DE' } }),
    deps,
  )
  const html = await res.text()
  assertStringIncludes(html, '<html lang="en">')
  assertStringIncludes(html, 'You will not get any more email from Coach Meier.')
})

Deno.test('the neutral page follows the browser, because there is nothing else to ask', async () => {
  const { deps } = makeFake()
  const res = await handleFollowupUnsubscribe(
    new Request(urlFor('garbage'), { method: 'GET', headers: { 'accept-language': 'en-GB,en;q=0.9' } }),
    deps,
  )
  assertEquals(await res.text(), renderUnsubscribeNeutralPage('en'))
})

Deno.test('a business name with markup in it cannot break out of the page', async () => {
  const { deps } = makeFake({
    identity: { ...IDENTITY, rendered_business_name: '<script>alert(1)</script>' },
  })
  const html = await (await call('GET', await signed(), deps)).text()
  assert(!html.includes('<script'), 'a coach-typed business name reached the page as markup')
  assertStringIncludes(html, '&lt;script&gt;')
})
