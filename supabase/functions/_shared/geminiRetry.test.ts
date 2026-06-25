import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { geminiFetchWithRetry } from './geminiRetry.ts'

const ok = (body = '{}') => new Response(body, { status: 200 })

Deno.test('geminiFetchWithRetry returns the response on first success (one call)', async () => {
  let calls = 0
  const res = await geminiFetchWithRetry(() => {
    calls++
    return Promise.resolve(ok('hi'))
  }, 'u', {})
  assertEquals(calls, 1)
  assertEquals(res.status, 200)
})

Deno.test('geminiFetchWithRetry retries a transient 503 then succeeds', async () => {
  let calls = 0
  const res = await geminiFetchWithRetry(() => {
    calls++
    return Promise.resolve(calls < 3 ? new Response('{}', { status: 503 }) : ok())
  }, 'u', {})
  assertEquals(calls, 3)
  assertEquals(res.ok, true)
})

Deno.test('geminiFetchWithRetry retries a network error then succeeds', async () => {
  let calls = 0
  const res = await geminiFetchWithRetry(() => {
    calls++
    return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(ok())
  }, 'u', {})
  assertEquals(calls, 2)
  assertEquals(res.ok, true)
})

Deno.test('geminiFetchWithRetry does NOT retry a 4xx — returns it immediately', async () => {
  let calls = 0
  const res = await geminiFetchWithRetry(() => {
    calls++
    return Promise.resolve(new Response('{}', { status: 400 }))
  }, 'u', {})
  assertEquals(calls, 1)
  assertEquals(res.status, 400)
})

Deno.test('geminiFetchWithRetry rethrows when every attempt fails at the network layer', async () => {
  let calls = 0
  await assertRejects(
    () =>
      geminiFetchWithRetry(() => {
        calls++
        return Promise.reject(new Error('down'))
      }, 'u', {}),
    Error,
    'down',
  )
  assertEquals(calls, 3)
})
