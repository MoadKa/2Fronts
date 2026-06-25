import { assertEquals } from 'jsr:@std/assert@1'
import { handleSubmitWish, type WishRow } from './index.ts'

function jsonReq(body: unknown, method = 'POST') {
  return new Request('http://localhost/submit-wish', {
    method,
    body: method === 'OPTIONS' || method === 'GET' ? undefined : JSON.stringify(body),
  })
}

function inserter() {
  const calls: Array<WishRow> = []
  return {
    deps: {
      insertWish: (row: WishRow) => {
        calls.push(row)
        return Promise.resolve()
      },
    },
    calls,
  }
}

Deno.test('inserts a wish row with all fields and returns 200', async () => {
  const { deps, calls } = inserter()
  const res = await handleSubmitWish(
    jsonReq({
      email: '  a@b.com  ',
      message: '  Bitte HubSpot-Sync  ',
      industry: 'coaching',
      locale: 'de',
      marketing_consent: true,
    }),
    deps,
  )

  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.ok, true)
  assertEquals(calls.length, 1)
  assertEquals(calls[0], {
    email: 'a@b.com',
    message: 'Bitte HubSpot-Sync',
    industry: 'coaching',
    locale: 'de',
    marketing_consent: true,
  })
})

Deno.test('blank message and industry normalise to null', async () => {
  const { deps, calls } = inserter()
  await handleSubmitWish(jsonReq({ email: 'a@b.com', message: '   ', industry: '   ' }), deps)
  assertEquals(calls[0].message, null)
  assertEquals(calls[0].industry, null)
  assertEquals(calls[0].locale, null)
})

Deno.test('only a real boolean true counts as marketing consent', async () => {
  const { deps, calls } = inserter()
  await handleSubmitWish(jsonReq({ email: 'a@b.com', marketing_consent: 'yes' }), deps)
  assertEquals(calls[0].marketing_consent, false)
})

Deno.test('returns 400 when email is missing (no insert)', async () => {
  const { deps, calls } = inserter()
  const res = await handleSubmitWish(jsonReq({}), deps)
  assertEquals(res.status, 400)
  assertEquals(calls.length, 0)
})

Deno.test('returns 400 when email is an empty string (no insert)', async () => {
  const { deps, calls } = inserter()
  const res = await handleSubmitWish(jsonReq({ email: '   ' }), deps)
  assertEquals(res.status, 400)
  assertEquals(calls.length, 0)
})

Deno.test('returns 400 for an invalid email format (no insert)', async () => {
  const { deps, calls } = inserter()
  for (const bad of ['notanemail', 'no@domain', 'a b@c.com', '@b.com', 'a@.com']) {
    const res = await handleSubmitWish(jsonReq({ email: bad }), deps)
    assertEquals(res.status, 400, `expected 400 for ${bad}`)
  }
  assertEquals(calls.length, 0)
})

Deno.test('returns 400 for a non-JSON body', async () => {
  const req = new Request('http://localhost/submit-wish', { method: 'POST', body: 'not json {' })
  const res = await handleSubmitWish(req, inserter().deps)
  assertEquals(res.status, 400)
})

Deno.test('returns 500 with a generic message when the insert throws', async () => {
  const deps = {
    insertWish: () => Promise.reject(new Error('db down')),
  }
  const res = await handleSubmitWish(jsonReq({ email: 'a@b.com' }), deps)
  assertEquals(res.status, 500)
  const body = await res.json()
  assertEquals(body.error, 'Could not submit your request — please try again')
})

Deno.test('handles CORS preflight', async () => {
  const res = await handleSubmitWish(jsonReq(undefined, 'OPTIONS'), inserter().deps)
  assertEquals(res.status, 200)
})

Deno.test('returns 405 for non-POST, non-OPTIONS methods', async () => {
  const res = await handleSubmitWish(jsonReq(undefined, 'GET'), inserter().deps)
  assertEquals(res.status, 405)
})
