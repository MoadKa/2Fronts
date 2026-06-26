import { assertEquals } from 'jsr:@std/assert@1'
import { handleNotifyRequest, type SendEmailArgs, type SendEmailFn } from './index.ts'

function jsonReq(body: unknown, method = 'POST') {
  return new Request('http://localhost/notify-request', {
    method,
    body: method === 'OPTIONS' || method === 'GET' ? undefined : JSON.stringify(body),
  })
}

// Build a sendEmail stub that records its calls, plus an env reader over a map.
function harness(envMap: Record<string, string | undefined>) {
  const calls: SendEmailArgs[] = []
  const sendEmail: SendEmailFn = (args) => {
    calls.push(args)
    return Promise.resolve(true)
  }
  const env = (key: string) => envMap[key]
  return { calls, deps: { sendEmail, env } }
}

Deno.test('skips (no API call) and returns skipped:true when RESEND_API_KEY is missing', async () => {
  const { calls, deps } = harness({ ADMIN_EMAIL: 'founder@example.com' })
  const res = await handleNotifyRequest(
    jsonReq({ automation_name: 'Invoice Sync', customer_email: 'c@x.com', request_id: 'req-1' }),
    deps,
  )
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { skipped: true })
  assertEquals(calls.length, 0)
})

Deno.test('skips (no API call) when ADMIN_EMAIL is missing', async () => {
  const { calls, deps } = harness({ RESEND_API_KEY: 'rk_test' })
  const res = await handleNotifyRequest(jsonReq({ automation_name: 'Invoice Sync' }), deps)
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { skipped: true })
  assertEquals(calls.length, 0)
})

Deno.test('sends once to ADMIN_EMAIL with the automation name in the subject when configured', async () => {
  const { calls, deps } = harness({
    RESEND_API_KEY: 'rk_test',
    ADMIN_EMAIL: 'founder@example.com',
    RESEND_FROM: 'Acme <hi@acme.test>',
  })
  const res = await handleNotifyRequest(
    jsonReq({ automation_name: 'Invoice Sync', customer_email: 'c@x.com', request_id: 'req-1' }),
    deps,
  )
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { sent: true })
  assertEquals(calls.length, 1)
  assertEquals(calls[0].to, 'founder@example.com')
  assertEquals(calls[0].from, 'Acme <hi@acme.test>')
  assertEquals(calls[0].apiKey, 'rk_test')
  assertEquals(calls[0].subject.includes('Invoice Sync'), true)
  // The body carries the lead details for the founder to read.
  assertEquals(calls[0].text.includes('c@x.com'), true)
  assertEquals(calls[0].text.includes('req-1'), true)
})

Deno.test('a comma-separated ADMIN_EMAIL goes to all recipients (e.g. also Gmail)', async () => {
  const { calls, deps } = harness({
    RESEND_API_KEY: 'rk_test',
    ADMIN_EMAIL: 'moad@2fronts.de, founder@gmail.com',
  })
  await handleNotifyRequest(jsonReq({ automation_name: 'X' }), deps)
  assertEquals(calls.length, 1)
  assertEquals(calls[0].to, ['moad@2fronts.de', 'founder@gmail.com'])
})

Deno.test('falls back to the default sender when RESEND_FROM is unset', async () => {
  const { calls, deps } = harness({ RESEND_API_KEY: 'rk_test', ADMIN_EMAIL: 'founder@example.com' })
  await handleNotifyRequest(jsonReq({ automation_name: 'X' }), deps)
  assertEquals(calls.length, 1)
  assertEquals(calls[0].from, '2Fronts <onboarding@resend.dev>')
})

Deno.test('trims and bounds the incoming fields', async () => {
  const { calls, deps } = harness({ RESEND_API_KEY: 'rk_test', ADMIN_EMAIL: 'founder@example.com' })
  const longName = 'a'.repeat(500)
  await handleNotifyRequest(jsonReq({ automation_name: `  ${longName}  ` }), deps)
  assertEquals(calls[0].subject.length < 300, true)
  // Trimmed: no leading spaces survived into the bounded value.
  assertEquals(calls[0].text.includes(' a'.repeat(2)), false)
})

Deno.test('returns 200 { sent: false } when the transport fails (never a 5xx)', async () => {
  const calls: SendEmailArgs[] = []
  const deps = {
    env: (k: string) => ({ RESEND_API_KEY: 'rk_test', ADMIN_EMAIL: 'founder@example.com' } as Record<string, string>)[k],
    sendEmail: (args: SendEmailArgs) => {
      calls.push(args)
      return Promise.resolve(false)
    },
  }
  const res = await handleNotifyRequest(jsonReq({ automation_name: 'X' }), deps)
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { sent: false })
  assertEquals(calls.length, 1)
})

Deno.test('handles CORS preflight (OPTIONS -> 200)', async () => {
  const { deps } = harness({})
  const res = await handleNotifyRequest(jsonReq(undefined, 'OPTIONS'), deps)
  assertEquals(res.status, 200)
})

Deno.test('returns 405 for non-POST, non-OPTIONS methods', async () => {
  const { deps } = harness({})
  const res = await handleNotifyRequest(jsonReq(undefined, 'GET'), deps)
  assertEquals(res.status, 405)
})

Deno.test('returns 400 for a non-JSON body', async () => {
  const { deps } = harness({ RESEND_API_KEY: 'rk_test', ADMIN_EMAIL: 'founder@example.com' })
  const req = new Request('http://localhost/notify-request', { method: 'POST', body: 'not json {' })
  const res = await handleNotifyRequest(req, deps)
  assertEquals(res.status, 400)
})
