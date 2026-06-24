import { assertEquals } from 'jsr:@std/assert@1'
import { handleCreateCheckout } from './index.ts'

interface FakeAutomation {
  name: string
  price_cents: number
  currency: string
  pricing_model?: string
  recurring_interval?: string
}

function fakeUserClient(automation: FakeAutomation, email = 'coach@example.com') {
  return () => ({
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                single: () =>
                  Promise.resolve({
                    data: { id: 'req-1', automations: automation, profiles: { email } },
                    error: null,
                  }),
              }
            },
          }
        },
      }
    },
  })
}

interface CapturedAdmin {
  // Last update patch per table, keyed by table name.
  patches: Record<string, Record<string, unknown>>
  // Back-compat: the patch on automation_requests (most tests assert this).
  patch?: Record<string, unknown>
  eqCalls: [string, unknown][]
}

function fakeAdminClient(captured: CapturedAdmin) {
  return () => ({
    from(table: string) {
      return {
        update(patch: Record<string, unknown>) {
          captured.patches[table] = patch
          if (table === 'automation_requests') captured.patch = patch
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
  const admin: CapturedAdmin = { eqCalls: [], patches: {} }
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

Deno.test('paid one-time automation creates a payment-mode Stripe session and marks payment_pending', async () => {
  const admin: CapturedAdmin = { eqCalls: [], patches: {} }
  let createdMode: string | undefined
  let createdParams: Record<string, unknown> | undefined

  const res = await handleCreateCheckout(req(), {
    stripe: {
      checkout: { sessions: { create: (params: Record<string, unknown>) => { createdMode = params.mode as string; createdParams = params; return Promise.resolve({ id: 'cs_1', url: 'https://stripe/pay' }) } } },
      customers: { create: () => { throw new Error('customers.create must NOT be called for a one-time automation') } },
    } as never,
    createUserClient: fakeUserClient({ name: 'Paid', price_cents: 49900, currency: 'eur' }) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200)
  assertEquals(createdMode, 'payment') // one-time path unchanged
  assertEquals(body.url, 'https://stripe/pay')
  assertEquals(admin.patch?.status, 'payment_pending')
  assertEquals(admin.patch?.stripe_checkout_session_id, 'cs_1')
  // No recurring price_data on the one-time path.
  const lineItem = (createdParams!.line_items as Array<{ price_data: Record<string, unknown> }>)[0]
  assertEquals('recurring' in lineItem.price_data, false)
})

Deno.test('subscription automation creates a subscription-mode session with a recurring price and a Stripe Customer', async () => {
  const admin: CapturedAdmin = { eqCalls: [], patches: {} }
  let createdParams: Record<string, unknown> | undefined
  let customerEmail: string | undefined

  const res = await handleCreateCheckout(req(), {
    stripe: {
      checkout: { sessions: { create: (params: Record<string, unknown>) => { createdParams = params; return Promise.resolve({ id: 'cs_sub', url: 'https://stripe/subscribe' }) } } },
      customers: { create: (params: { email?: string }) => { customerEmail = params.email; return Promise.resolve({ id: 'cus_123' }) } },
    } as never,
    createUserClient: fakeUserClient({ name: 'Concierge', price_cents: 7900, currency: 'eur', pricing_model: 'subscription', recurring_interval: 'month' }, 'coach@example.com') as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200)
  assertEquals(body.url, 'https://stripe/subscribe')
  assertEquals(createdParams!.mode, 'subscription')
  assertEquals(createdParams!.customer, 'cus_123')
  assertEquals(customerEmail, 'coach@example.com') // named Customer attached
  const lineItem = (createdParams!.line_items as Array<{ price_data: { recurring?: { interval: string } } }>)[0]
  assertEquals(lineItem.price_data.recurring?.interval, 'month') // recurring price
  // request mapped + the customer id persisted on the provision now.
  assertEquals(admin.patches['automation_requests'].status, 'payment_pending')
  assertEquals(admin.patches['automation_provisions'].stripe_customer_id, 'cus_123')
})
