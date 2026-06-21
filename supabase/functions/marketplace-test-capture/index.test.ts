import { assertEquals } from 'jsr:@std/assert@1'
import { handleMarketplaceCapture } from './index.ts'

function jsonReq(body: unknown, method = 'POST') {
  return new Request('http://localhost/marketplace-test-capture', {
    method,
    body: method === 'OPTIONS' ? undefined : JSON.stringify(body),
  })
}

Deno.test('returns 200 and relays to the webhook when input is valid', async () => {
  let calledUrl = ''
  const res = await handleMarketplaceCapture(jsonReq({ email: 'a@b.com', business_name: 'Acme Plumbing' }), {
    getWebhookUrl: () => 'https://hooks.example.com/abc',
    fetchImpl: ((url: string) => {
      calledUrl = url
      return Promise.resolve(new Response('ok', { status: 200 }))
    }) as typeof fetch,
  })

  assertEquals(res.status, 200)
  assertEquals(calledUrl, 'https://hooks.example.com/abc')
})

// Regression: live QA against the real Slack webhook returned 400 "no_text" —
// Slack's Incoming Webhook API requires a top-level "text" field; the
// function was forwarding raw {email, business_name, ...} JSON instead.
// Found by /qa on 2026-06-21.
Deno.test('formats the webhook payload as Slack-compatible {text: ...} including email, business name, and automation of interest', async () => {
  let calledBody: unknown
  await handleMarketplaceCapture(
    jsonReq({ email: 'a@b.com', business_name: 'Acme Plumbing', automation_of_interest: 'AI Missed-Call Recovery' }),
    {
      getWebhookUrl: () => 'https://hooks.example.com/abc',
      fetchImpl: ((_url: string, init?: RequestInit) => {
        calledBody = JSON.parse(init?.body as string)
        return Promise.resolve(new Response('ok', { status: 200 }))
      }) as typeof fetch,
    }
  )

  const text = (calledBody as { text: string }).text
  assertEquals(typeof text, 'string')
  assertEquals(text.includes('a@b.com'), true)
  assertEquals(text.includes('Acme Plumbing'), true)
  assertEquals(text.includes('AI Missed-Call Recovery'), true)
})

Deno.test('formats the webhook payload with a placeholder when automation of interest is not provided', async () => {
  let calledBody: unknown
  await handleMarketplaceCapture(jsonReq({ email: 'a@b.com', business_name: 'Acme Plumbing' }), {
    getWebhookUrl: () => 'https://hooks.example.com/abc',
    fetchImpl: ((_url: string, init?: RequestInit) => {
      calledBody = JSON.parse(init?.body as string)
      return Promise.resolve(new Response('ok', { status: 200 }))
    }) as typeof fetch,
  })

  const text = (calledBody as { text: string }).text
  assertEquals(text.includes('not specified'), true)
})

Deno.test('returns 400 when email is missing', async () => {
  const res = await handleMarketplaceCapture(jsonReq({ business_name: 'Acme Plumbing' }), {
    getWebhookUrl: () => 'https://hooks.example.com/abc',
    fetchImpl: (() => {
      throw new Error('should not be called')
    }) as unknown as typeof fetch,
  })
  assertEquals(res.status, 400)
})

Deno.test('returns 400 when business_name is missing', async () => {
  const res = await handleMarketplaceCapture(jsonReq({ email: 'a@b.com' }), {
    getWebhookUrl: () => 'https://hooks.example.com/abc',
    fetchImpl: (() => {
      throw new Error('should not be called')
    }) as unknown as typeof fetch,
  })
  assertEquals(res.status, 400)
})

Deno.test('returns 400 when email is an empty string', async () => {
  const res = await handleMarketplaceCapture(jsonReq({ email: '   ', business_name: 'Acme' }), {
    getWebhookUrl: () => 'https://hooks.example.com/abc',
    fetchImpl: (() => {
      throw new Error('should not be called')
    }) as unknown as typeof fetch,
  })
  assertEquals(res.status, 400)
})

Deno.test('returns 500 with a generic message (no secret leak) when the webhook URL is not configured', async () => {
  const res = await handleMarketplaceCapture(jsonReq({ email: 'a@b.com', business_name: 'Acme' }), {
    getWebhookUrl: () => undefined,
    fetchImpl: (() => {
      throw new Error('should not be called')
    }) as unknown as typeof fetch,
  })
  assertEquals(res.status, 500)
  const body = await res.json()
  assertEquals(body.error, 'Could not send your request — please try again')
})

Deno.test('returns 500 when the webhook call throws (timeout/network error)', async () => {
  const res = await handleMarketplaceCapture(jsonReq({ email: 'a@b.com', business_name: 'Acme' }), {
    getWebhookUrl: () => 'https://hooks.example.com/abc',
    fetchImpl: (() => Promise.reject(new Error('timeout'))) as unknown as typeof fetch,
  })
  assertEquals(res.status, 500)
  const body = await res.json()
  assertEquals(body.error, 'Could not send your request — please try again')
})

Deno.test('returns 500 when the webhook responds with a non-2xx status', async () => {
  const res = await handleMarketplaceCapture(jsonReq({ email: 'a@b.com', business_name: 'Acme' }), {
    getWebhookUrl: () => 'https://hooks.example.com/abc',
    fetchImpl: (() => Promise.resolve(new Response('nope', { status: 503 }))) as unknown as typeof fetch,
  })
  assertEquals(res.status, 500)
})

Deno.test('handles CORS preflight', async () => {
  const res = await handleMarketplaceCapture(jsonReq(undefined, 'OPTIONS'), {
    getWebhookUrl: () => 'https://hooks.example.com/abc',
    fetchImpl: fetch,
  })
  assertEquals(res.status, 200)
})

Deno.test('returns 405 for non-POST, non-OPTIONS methods', async () => {
  const res = await handleMarketplaceCapture(jsonReq(undefined, 'GET'), {
    getWebhookUrl: () => 'https://hooks.example.com/abc',
    fetchImpl: fetch,
  })
  assertEquals(res.status, 405)
})
