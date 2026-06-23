import { assertEquals } from 'jsr:@std/assert@1'
import { handleCreateCheckout } from './index.ts'

function fakeUserClient(automation: { name: string; price_cents: number; currency: string }) {
  return () => ({
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                single: () =>
                  Promise.resolve({ data: { id: 'req-1', automations: automation }, error: null }),
              }
            },
          }
        },
      }
    },
  })
}

interface CapturedAdmin {
  patch?: Record<string, unknown>
  eqCalls: [string, unknown][]
}

function fakeAdminClient(captured: CapturedAdmin) {
  return () => ({
    from() {
      return {
        update(patch: Record<string, unknown>) {
          captured.patch = patch
          const chain = {
            eq(col: string, val: unknown) {
              captured.eqCalls.push([col, val])
              return chain
            },
          }
          return chain
        },
      }
    },
  })
}

function req(): Request {
  return new Request('http://x/create-checkout-session', {
    method: 'POST',
    headers: { Authorization: 'Bearer t' },
    body: JSON.stringify({ requestId: 'req-1' }),
  })
}

const getEnv = (k: string) => (k === 'PUBLIC_APP_URL' ? 'https://2fronts.de' : undefined)

Deno.test('free (0-amount) automation skips Stripe, marks paid, and fulfills', async () => {
  const admin: CapturedAdmin = { eqCalls: [] }
  let stripeCalled = false
  let fulfilledRequestId: string | null = null

  const res = await handleCreateCheckout(req(), {
    stripe: { checkout: { sessions: { create: () => { stripeCalled = true; return Promise.resolve({ url: 'should-not-happen' }) } } } } as never,
    createUserClient: fakeUserClient({ name: 'Test', price_cents: 0, currency: 'eur' }) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: (_admin, requestId) => { fulfilledRequestId = requestId; return Promise.resolve() },
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200)
  assertEquals(stripeCalled, false) // Stripe never touched for a free automation
  assertEquals(body.url, 'https://2fronts.de/checkout/result?status=success')
  assertEquals(admin.patch?.status, 'paid') // request marked paid server-side
  assertEquals(fulfilledRequestId, 'req-1') // shared fulfillment ran
})

Deno.test('paid automation creates a Stripe session and marks payment_pending', async () => {
  const admin: CapturedAdmin = { eqCalls: [] }
  let stripeCalled = false

  const res = await handleCreateCheckout(req(), {
    stripe: { checkout: { sessions: { create: () => { stripeCalled = true; return Promise.resolve({ id: 'cs_1', url: 'https://stripe/pay' }) } } } } as never,
    createUserClient: fakeUserClient({ name: 'Paid', price_cents: 49900, currency: 'eur' }) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200)
  assertEquals(stripeCalled, true)
  assertEquals(body.url, 'https://stripe/pay')
  assertEquals(admin.patch?.status, 'payment_pending')
  assertEquals(admin.patch?.stripe_checkout_session_id, 'cs_1')
})
