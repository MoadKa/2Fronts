import { assertEquals } from 'jsr:@std/assert@1'
import { handleCreateCheckout } from './index.ts'

interface FakeAutomation {
  name: string
  price_cents: number
  currency: string
  pricing_model?: string
  recurring_interval?: string
}

function fakeUserClient(
  automation: FakeAutomation,
  email = 'coach@example.com',
  stripeCustomerId: string | null = null,
) {
  return () => ({
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                single: () =>
                  Promise.resolve({
                    data: {
                      id: 'req-1',
                      customer_id: 'user-1',
                      automations: automation,
                      profiles: { email, stripe_customer_id: stripeCustomerId },
                    },
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
  // Rows the trial-eligibility select on automation_provisions returns
  // (default: none, i.e. first-time subscriber).
  priorProvisions?: unknown[]
  // When set, the trial-eligibility select rejects with this error.
  priorProvisionsError?: Error
  // When set, the trial-eligibility select RESOLVES with this error in the
  // supabase result envelope (the { data, error } shape) instead of rejecting.
  priorProvisionsResolvedError?: Error
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
        select() {
          // Mirrors the .not().eq().limit() trial-eligibility chain; only
          // limit() resolves, matching how the handler awaits the query.
          const chain = {
            not: () => chain,
            eq: () => chain,
            limit: () =>
              captured.priorProvisionsError
                ? Promise.reject(captured.priorProvisionsError)
                : captured.priorProvisionsResolvedError
                  ? Promise.resolve({ data: null, error: captured.priorProvisionsResolvedError })
                  : Promise.resolve({ data: captured.priorProvisions ?? [], error: null }),
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

// A stripe fake for the subscription path: records the session params, mints
// cus_new when asked, and lets a test forbid customers.create entirely.
function subscriptionStripe(captured: { params?: Record<string, unknown> }, opts: { forbidCustomerCreate?: boolean } = {}) {
  return {
    checkout: { sessions: { create: (params: Record<string, unknown>) => { captured.params = params; return Promise.resolve({ id: 'cs_sub', url: 'https://stripe/subscribe' }) } } },
    customers: {
      create: () => {
        if (opts.forbidCustomerCreate) throw new Error('customers.create must NOT be called when a stripe_customer_id is stored')
        return Promise.resolve({ id: 'cus_new' })
      },
    },
  } as never
}

const CONCIERGE: FakeAutomation = { name: 'Concierge', price_cents: 20000, currency: 'eur', pricing_model: 'subscription', recurring_interval: 'month' }

Deno.test('first-time subscriber gets a 14-day trial on the subscription', async () => {
  const admin: CapturedAdmin = { eqCalls: [], patches: {} } // no prior provisions
  const stripe: { params?: Record<string, unknown> } = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient(CONCIERGE) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200)
  assertEquals(body.url, 'https://stripe/subscribe')
  const subData = stripe.params!.subscription_data as { trial_period_days?: number }
  assertEquals(subData.trial_period_days, 14) // card now, first charge on day 15
})

Deno.test('returning subscriber (prior provision with a subscription id) gets NO trial and checkout still works', async () => {
  const admin: CapturedAdmin = {
    eqCalls: [],
    patches: {},
    // The coach subscribed before: a provision row carries a subscription id.
    priorProvisions: [{ id: 'prov-1', automation_requests: { customer_id: 'user-1' } }],
  }
  const stripe: { params?: Record<string, unknown> } = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient(CONCIERGE) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200) // checkout must not break for returning buyers
  assertEquals(body.url, 'https://stripe/subscribe')
  const subData = stripe.params!.subscription_data as Record<string, unknown>
  assertEquals('trial_period_days' in subData, false) // charged immediately
  assertEquals(subData.metadata, { request_id: 'req-1' }) // webhook mapping intact
})

Deno.test('stored stripe_customer_id is reused: no new Stripe Customer, session uses the stored id', async () => {
  const admin: CapturedAdmin = { eqCalls: [], patches: {} }
  const stripe: { params?: Record<string, unknown> } = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe, { forbidCustomerCreate: true }),
    createUserClient: fakeUserClient(CONCIERGE, 'coach@example.com', 'cus_stored') as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  assertEquals(res.status, 200)
  assertEquals(stripe.params!.customer, 'cus_stored') // reused, not recreated
  assertEquals(admin.patches['profiles'], undefined) // nothing re-persisted
  assertEquals(admin.patches['automation_provisions'].stripe_customer_id, 'cus_stored')
})

Deno.test('no stored customer id: Stripe Customer is created and persisted to profiles', async () => {
  const admin: CapturedAdmin = { eqCalls: [], patches: {} }
  const stripe: { params?: Record<string, unknown> } = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient(CONCIERGE) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  assertEquals(res.status, 200)
  assertEquals(stripe.params!.customer, 'cus_new')
  assertEquals(admin.patches['profiles'].stripe_customer_id, 'cus_new') // stored for reuse
  assertEquals(admin.eqCalls.some(([col, val]) => col === 'id' && val === 'user-1'), true) // on the caller's profile row
})

Deno.test('trial subscription_data still carries request_id metadata for the webhook', async () => {
  const admin: CapturedAdmin = { eqCalls: [], patches: {} } // first-time subscriber
  const stripe: { params?: Record<string, unknown> } = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient(CONCIERGE) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  assertEquals(res.status, 200)
  const subData = stripe.params!.subscription_data as { metadata?: Record<string, string>; trial_period_days?: number }
  // The trial branch must not drop the request_id the webhook maps back from.
  assertEquals(subData.metadata, { request_id: 'req-1' })
  assertEquals(subData.trial_period_days, 14)
  assertEquals((stripe.params!.metadata as Record<string, string>).request_id, 'req-1')
})

Deno.test('trial-eligibility select resolving with a supabase error envelope also fails closed', async () => {
  const admin: CapturedAdmin = {
    eqCalls: [],
    patches: {},
    // Not a rejected promise: supabase-js normally RESOLVES with { data, error }.
    // This exercises the `if (priorError) throw priorError` branch.
    priorProvisionsResolvedError: new Error('permission denied'),
  }
  const stripe: { params?: Record<string, unknown> } = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient(CONCIERGE) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200) // checkout survives the lookup error
  assertEquals(body.url, 'https://stripe/subscribe')
  const subData = stripe.params!.subscription_data as Record<string, unknown>
  assertEquals('trial_period_days' in subData, false) // fail closed: no trial
})

Deno.test('trial-eligibility lookup failure fails closed: no trial, checkout still succeeds', async () => {
  const admin: CapturedAdmin = {
    eqCalls: [],
    patches: {},
    priorProvisionsError: new Error('db unavailable'),
  }
  const stripe: { params?: Record<string, unknown> } = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient(CONCIERGE) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200) // eligibility outage never blocks checkout
  assertEquals(body.url, 'https://stripe/subscribe')
  const subData = stripe.params!.subscription_data as Record<string, unknown>
  assertEquals('trial_period_days' in subData, false) // fail closed: no trial
})
