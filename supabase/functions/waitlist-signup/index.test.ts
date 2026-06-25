import { assertEquals } from 'jsr:@std/assert@1'
import { handleWaitlistSignup, type InsertResult, type SignupRow } from './index.ts'

function jsonReq(body: unknown, method = 'POST') {
  return new Request('http://localhost/waitlist-signup', {
    method,
    body: method === 'OPTIONS' || method === 'GET' ? undefined : JSON.stringify(body),
  })
}

function inserter(result: InsertResult) {
  const calls: Array<SignupRow> = []
  return {
    deps: {
      insertSignup: (row: SignupRow) => {
        calls.push(row)
        return Promise.resolve(result)
      },
    },
    calls,
  }
}

Deno.test('inserts a new signup and returns 200 with alreadySubscribed=false', async () => {
  const { deps, calls } = inserter({ duplicate: false })
  const res = await handleWaitlistSignup(jsonReq({ email: 'a@b.com', locale: 'de', source: 'landing' }), deps)

  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.ok, true)
  assertEquals(body.alreadySubscribed, false)
  assertEquals(calls.length, 1)
  assertEquals(calls[0], { email: 'a@b.com', locale: 'de', source: 'landing', message: null, marketing_consent: false })
})

Deno.test('stores the catalog request message and marketing consent', async () => {
  const { deps, calls } = inserter({ duplicate: false })
  const res = await handleWaitlistSignup(
    jsonReq({ email: 'a@b.com', source: 'catalog_request', message: '  Bitte HubSpot-Sync  ', marketing_consent: true }),
    deps,
  )
  assertEquals(res.status, 200)
  assertEquals(calls[0].message, 'Bitte HubSpot-Sync')
  assertEquals(calls[0].marketing_consent, true)
})

Deno.test('marketing_consent defaults to false and message to null when omitted/blank', async () => {
  const { deps, calls } = inserter({ duplicate: false })
  await handleWaitlistSignup(jsonReq({ email: 'a@b.com', message: '   ', marketing_consent: 'yes' }), deps)
  assertEquals(calls[0].message, null)
  // Only a real boolean true counts as consent; a truthy string must not.
  assertEquals(calls[0].marketing_consent, false)
})

Deno.test('trims the email before inserting', async () => {
  const { deps, calls } = inserter({ duplicate: false })
  await handleWaitlistSignup(jsonReq({ email: '  a@b.com  ' }), deps)
  assertEquals(calls[0].email, 'a@b.com')
})

Deno.test('normalises missing locale/source to null', async () => {
  const { deps, calls } = inserter({ duplicate: false })
  await handleWaitlistSignup(jsonReq({ email: 'a@b.com' }), deps)
  assertEquals(calls[0].locale, null)
  assertEquals(calls[0].source, null)
})

Deno.test('returns 200 alreadySubscribed=true on a duplicate (no 500, no second row)', async () => {
  const { deps } = inserter({ duplicate: true })
  const res = await handleWaitlistSignup(jsonReq({ email: 'dup@b.com' }), deps)

  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.ok, true)
  assertEquals(body.alreadySubscribed, true)
})

Deno.test('returns 400 when email is missing', async () => {
  const { deps, calls } = inserter({ duplicate: false })
  const res = await handleWaitlistSignup(jsonReq({}), deps)
  assertEquals(res.status, 400)
  assertEquals(calls.length, 0)
})

Deno.test('returns 400 when email is an empty string', async () => {
  const { deps, calls } = inserter({ duplicate: false })
  const res = await handleWaitlistSignup(jsonReq({ email: '   ' }), deps)
  assertEquals(res.status, 400)
  assertEquals(calls.length, 0)
})

Deno.test('returns 400 for an invalid email format', async () => {
  const { deps, calls } = inserter({ duplicate: false })
  for (const bad of ['notanemail', 'no@domain', 'a b@c.com', '@b.com', 'a@.com']) {
    const res = await handleWaitlistSignup(jsonReq({ email: bad }), deps)
    assertEquals(res.status, 400, `expected 400 for ${bad}`)
  }
  assertEquals(calls.length, 0)
})

Deno.test('returns 400 for a non-JSON body', async () => {
  const req = new Request('http://localhost/waitlist-signup', { method: 'POST', body: 'not json {' })
  const res = await handleWaitlistSignup(req, inserter({ duplicate: false }).deps)
  assertEquals(res.status, 400)
})

Deno.test('returns 500 with a generic message when the insert throws', async () => {
  const deps = {
    insertSignup: () => Promise.reject(new Error('db down')),
  }
  const res = await handleWaitlistSignup(jsonReq({ email: 'a@b.com' }), deps)
  assertEquals(res.status, 500)
  const body = await res.json()
  assertEquals(body.error, 'Could not add you to the waitlist — please try again')
})

Deno.test('handles CORS preflight', async () => {
  const res = await handleWaitlistSignup(jsonReq(undefined, 'OPTIONS'), inserter({ duplicate: false }).deps)
  assertEquals(res.status, 200)
})

Deno.test('returns 405 for non-POST, non-OPTIONS methods', async () => {
  const res = await handleWaitlistSignup(jsonReq(undefined, 'GET'), inserter({ duplicate: false }).deps)
  assertEquals(res.status, 405)
})
