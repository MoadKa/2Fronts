import { assertEquals } from 'jsr:@std/assert@1'
import { handleCreateCheckout } from './index.ts'

interface FakeAutomation {
  name: string
  price_cents: number
  currency: string
  pricing_model?: string
  recurring_interval?: string
  connector_type?: string
}

function fakeUserClient(
  automation: FakeAutomation,
  email = 'coach@example.com',
  stripeCustomerId: string | null = null,
  status = 'requested',
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
                      status,
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

// One recorded filter step of a select/update chain: [method, ...args].
type FilterCall = unknown[]

interface CapturedAdmin {
  // Last update patch per table, keyed by table name.
  patches: Record<string, Record<string, unknown>>
  // Back-compat: the patch on automation_requests (most tests assert this).
  patch?: Record<string, unknown>
  eqCalls: [string, unknown][]
  // Every update call in order, with its filter chain (eq/is steps).
  updates: { table: string; patch: Record<string, unknown>; filters: FilterCall[] }[]
  // Every select chain in order, with the requested columns + filter steps.
  selects: { table: string; columns?: string; filters: FilterCall[] }[]
  // Every insert in order.
  inserts: { table: string; row: Record<string, unknown> }[]
  // Rows the trial-eligibility select on automation_provisions returns
  // (default: none, i.e. first-time subscriber).
  priorProvisions?: unknown[]
  // When set, the trial-eligibility select rejects with this error.
  priorProvisionsError?: Error
  // When set, the trial-eligibility select RESOLVES with this error in the
  // supabase result envelope (the { data, error } shape) instead of rejecting.
  priorProvisionsResolvedError?: Error
  // When true, the race-guarded profiles persist matches zero rows (a
  // concurrent checkout already stored an id).
  persistRaceLost?: boolean
  // The id the profile re-read returns after a lost persist race.
  raceWinnerCustomerId?: string | null
  // When set, the race-guarded profiles persist resolves with this error.
  persistError?: Error
  // When true, the provision self-heal existence check finds no row.
  provisionMissing?: boolean
}

function newAdmin(overrides: Partial<CapturedAdmin> = {}): CapturedAdmin {
  return { eqCalls: [], patches: {}, updates: [], selects: [], inserts: [], ...overrides }
}

function fakeAdminClient(captured: CapturedAdmin) {
  return () => ({
    from(table: string) {
      return {
        update(patch: Record<string, unknown>) {
          captured.patches[table] = patch
          if (table === 'automation_requests') captured.patch = patch
          const record = { table, patch, filters: [] as FilterCall[] }
          captured.updates.push(record)
          const chain = {
            eq(col: string, val: unknown) {
              captured.eqCalls.push([col, val])
              record.filters.push(['eq', col, val])
              return chain
            },
            is(col: string, val: unknown) {
              record.filters.push(['is', col, val])
              return chain
            },
            // The race-guarded profiles persist ends in .select() and inspects
            // the affected rows: zero rows = a concurrent checkout won.
            select: () =>
              captured.persistError
                ? Promise.resolve({ data: null, error: captured.persistError })
                : Promise.resolve({ data: captured.persistRaceLost ? [] : [{ id: 'user-1' }], error: null }),
          }
          return chain
        },
        insert(row: Record<string, unknown>) {
          captured.inserts.push({ table, row })
          return Promise.resolve({ error: null })
        },
        select(columns?: string) {
          const record = { table, columns, filters: [] as FilterCall[] }
          captured.selects.push(record)
          if (table === 'profiles') {
            // Profile re-read after a lost persist race.
            const chain = {
              eq(col: string, val: unknown) {
                record.filters.push(['eq', col, val])
                return chain
              },
              single: () =>
                Promise.resolve({ data: { stripe_customer_id: captured.raceWinnerCustomerId ?? null }, error: null }),
            }
            return chain
          }
          // automation_provisions: the trial-eligibility chain ends in
          // .limit(); the provision self-heal existence check ends in
          // .maybeSingle(). Both share the filter-recording steps.
          const chain = {
            not(...args: unknown[]) {
              record.filters.push(['not', ...args])
              return chain
            },
            eq(...args: unknown[]) {
              record.filters.push(['eq', ...args])
              return chain
            },
            limit: () =>
              captured.priorProvisionsError
                ? Promise.reject(captured.priorProvisionsError)
                : captured.priorProvisionsResolvedError
                  ? Promise.resolve({ data: null, error: captured.priorProvisionsResolvedError })
                  : Promise.resolve({ data: captured.priorProvisions ?? [], error: null }),
            maybeSingle: () =>
              Promise.resolve({ data: captured.provisionMissing ? null : { id: 'prov-existing' }, error: null }),
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
  const admin = newAdmin()
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

Deno.test('a request that is already paid returns 409 and never reaches Stripe', async () => {
  const admin = newAdmin()
  let stripeCalled = false

  const res = await handleCreateCheckout(req(), {
    stripe: { checkout: { sessions: { create: () => { stripeCalled = true; return Promise.resolve({ url: 'should-not-happen' }) } } } } as never,
    createUserClient: fakeUserClient({ name: 'Paid', price_cents: 49900, currency: 'eur' }, 'coach@example.com', null, 'paid') as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.reject(new Error('must not fulfill a completed request again')),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 409)
  assertEquals(body.error, 'Request already completed')
  assertEquals(stripeCalled, false) // no second charge / second subscription
  assertEquals(admin.updates.length, 0) // nothing mutated
})

Deno.test('paid one-time automation creates a payment-mode Stripe session and marks payment_pending', async () => {
  const admin = newAdmin()
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
  const admin = newAdmin()
  let createdParams: Record<string, unknown> | undefined
  let customerEmail: string | undefined

  const res = await handleCreateCheckout(req(), {
    stripe: {
      checkout: { sessions: { create: (params: Record<string, unknown>) => { createdParams = params; return Promise.resolve({ id: 'cs_sub', url: 'https://stripe/subscribe' }) } } },
      customers: { create: (params: { email?: string }) => { customerEmail = params.email; return Promise.resolve({ id: 'cus_123' }) } },
      subscriptions: { list: () => Promise.resolve({ data: [] }) },
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

// A stripe fake for the subscription path: records every session create's
// params, mints cus_new when asked, and lets a test forbid customers.create,
// stock the Customer's Stripe-side subscription history, or make the first
// session create fail (the stale-customer retry).
interface SubscriptionStripeCaptured {
  params?: Record<string, unknown>
  allParams?: Record<string, unknown>[]
  listedCustomer?: string
}
interface SubscriptionStripeOpts {
  forbidCustomerCreate?: boolean
  // subscriptions.list result for the Customer (default: no history).
  subscriptionsList?: unknown[]
  // When set, subscriptions.list rejects with this error.
  subscriptionsListError?: Error
  // When set, the FIRST checkout.sessions.create throws this; retries succeed.
  failFirstSessionCreate?: unknown
}
function subscriptionStripe(captured: SubscriptionStripeCaptured, opts: SubscriptionStripeOpts = {}) {
  let sessionCreates = 0
  return {
    checkout: {
      sessions: {
        create: (params: Record<string, unknown>) => {
          sessionCreates += 1
          captured.params = params
          ;(captured.allParams ??= []).push(params)
          if (sessionCreates === 1 && opts.failFirstSessionCreate) {
            return Promise.reject(opts.failFirstSessionCreate)
          }
          return Promise.resolve({ id: 'cs_sub', url: 'https://stripe/subscribe' })
        },
      },
    },
    customers: {
      create: () => {
        if (opts.forbidCustomerCreate) throw new Error('customers.create must NOT be called when a stripe_customer_id is stored')
        return Promise.resolve({ id: 'cus_new' })
      },
    },
    subscriptions: {
      list: (params: { customer: string }) => {
        captured.listedCustomer = params.customer
        if (opts.subscriptionsListError) return Promise.reject(opts.subscriptionsListError)
        return Promise.resolve({ data: opts.subscriptionsList ?? [] })
      },
    },
  } as never
}

const CONCIERGE: FakeAutomation = { name: 'Concierge', price_cents: 20000, currency: 'eur', pricing_model: 'subscription', recurring_interval: 'month', connector_type: 'booking_concierge' }

Deno.test('first-time subscriber gets a 14-day trial on the subscription', async () => {
  const admin = newAdmin() // no prior provisions
  const stripe: SubscriptionStripeCaptured = {}

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
  const admin = newAdmin({
    // The coach subscribed before: a provision row carries a subscription id.
    priorProvisions: [{ id: 'prov-1', automation_requests: { customer_id: 'user-1' } }],
  })
  const stripe: SubscriptionStripeCaptured = {}

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

Deno.test('trial-eligibility select filters on the caller and on a non-null subscription id', async () => {
  const admin = newAdmin()
  const stripe: SubscriptionStripeCaptured = {}

  await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient(CONCIERGE) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  // The eligibility query is the provisions select that joins the request. It
  // MUST scope to the calling coach (not all coaches) and only count provisions
  // that actually carry a subscription id — otherwise every pending provision
  // row would cost someone their trial (or leak another coach's history).
  const eligibility = admin.selects.find(
    (s) => s.table === 'automation_provisions' && (s.columns ?? '').includes('automation_requests!inner'),
  )
  assertEquals(eligibility !== undefined, true)
  assertEquals(eligibility!.filters.some(([m, col, op, val]) => m === 'not' && col === 'stripe_subscription_id' && op === 'is' && val === null), true)
  assertEquals(eligibility!.filters.some(([m, col, val]) => m === 'eq' && col === 'automation_requests.customer_id' && val === 'user-1'), true)
})

Deno.test('stored stripe_customer_id is reused: no new Stripe Customer, session uses the stored id', async () => {
  const admin = newAdmin()
  const stripe: SubscriptionStripeCaptured = {}

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
  const admin = newAdmin()
  const stripe: SubscriptionStripeCaptured = {}

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
  // The persist is race-guarded: it only fills a still-empty column.
  const persist = admin.updates.find((u) => u.table === 'profiles')
  assertEquals(persist!.filters.some(([m, col, val]) => m === 'is' && col === 'stripe_customer_id' && val === null), true)
})

Deno.test('lost persist race (zero rows updated): the concurrent winner\'s stored id is used for the session', async () => {
  const admin = newAdmin({ persistRaceLost: true, raceWinnerCustomerId: 'cus_winner' })
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient(CONCIERGE) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  assertEquals(res.status, 200)
  // Not cus_new (the id this request minted): both checkouts converge on the
  // winner's Customer so the coach ends up with exactly one.
  assertEquals(stripe.params!.customer, 'cus_winner')
  assertEquals(admin.patches['automation_provisions'].stripe_customer_id, 'cus_winner')
})

Deno.test('persist error: checkout still succeeds with the freshly created Customer', async () => {
  const admin = newAdmin({ persistError: new Error('db unavailable') })
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient(CONCIERGE) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200) // bookkeeping failure never blocks the purchase
  assertEquals(body.url, 'https://stripe/subscribe')
  assertEquals(stripe.params!.customer, 'cus_new')
})

Deno.test('re-used Customer with Stripe-side subscription history gets NO trial even when the DB says eligible', async () => {
  const admin = newAdmin() // DB knows of no prior subscription
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe, { forbidCustomerCreate: true, subscriptionsList: [{ id: 'sub_old', status: 'canceled' }] }),
    createUserClient: fakeUserClient(CONCIERGE, 'coach@example.com', 'cus_stored') as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  assertEquals(res.status, 200)
  assertEquals(stripe.listedCustomer, 'cus_stored') // Stripe asked about THIS Customer
  const subData = stripe.params!.subscription_data as Record<string, unknown>
  assertEquals('trial_period_days' in subData, false) // Stripe history vetoes the trial
})

Deno.test('Stripe subscription-history lookup failure keeps the DB verdict (trial still granted)', async () => {
  const admin = newAdmin() // DB: first-time subscriber
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe, { forbidCustomerCreate: true, subscriptionsListError: new Error('stripe down') }),
    createUserClient: fakeUserClient(CONCIERGE, 'coach@example.com', 'cus_stored') as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200) // a Stripe outage never crashes checkout
  assertEquals(body.url, 'https://stripe/subscribe')
  const subData = stripe.params!.subscription_data as { trial_period_days?: number }
  assertEquals(subData.trial_period_days, 14) // DB verdict stands
})

Deno.test('stored customer id AND a prior provision: Customer reused and NO trial', async () => {
  const admin = newAdmin({
    priorProvisions: [{ id: 'prov-1', automation_requests: { customer_id: 'user-1' } }],
  })
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe, { forbidCustomerCreate: true }),
    createUserClient: fakeUserClient(CONCIERGE, 'coach@example.com', 'cus_stored') as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  assertEquals(res.status, 200)
  assertEquals(stripe.params!.customer, 'cus_stored') // reuse
  const subData = stripe.params!.subscription_data as Record<string, unknown>
  assertEquals('trial_period_days' in subData, false) // returning subscriber
})

Deno.test('missing provision row is self-healed with a minimal pending insert before checkout', async () => {
  const admin = newAdmin({ provisionMissing: true })
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient(CONCIERGE) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  assertEquals(res.status, 200)
  const insert = admin.inserts.find((i) => i.table === 'automation_provisions')
  assertEquals(insert !== undefined, true) // the hole is closed server-side
  assertEquals(insert!.row.request_id, 'req-1')
  assertEquals(insert!.row.status, 'pending')
  assertEquals(insert!.row.connector_type, 'booking_concierge') // derived from the automation
})

Deno.test('existing provision row is left alone (no duplicate insert)', async () => {
  const admin = newAdmin() // provision exists (default)
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient(CONCIERGE) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  assertEquals(res.status, 200)
  assertEquals(admin.inserts.length, 0)
})

Deno.test('stale stored Customer (resource_missing): cleared, fresh Customer minted, session retried once', async () => {
  const admin = newAdmin()
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe, {
      // Stripe rejects the stored Customer id on the first session create.
      failFirstSessionCreate: { code: 'resource_missing', param: 'customer' },
    }),
    createUserClient: fakeUserClient(CONCIERGE, 'coach@example.com', 'cus_stale') as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200) // the coach never sees the stale id
  assertEquals(body.url, 'https://stripe/subscribe')
  assertEquals(stripe.allParams!.length, 2) // exactly one retry
  assertEquals(stripe.allParams![0].customer, 'cus_stale')
  assertEquals(stripe.allParams![1].customer, 'cus_new') // fresh Customer on the retry
  // The stale id was cleared before the fresh one was persisted.
  const profileUpdates = admin.updates.filter((u) => u.table === 'profiles')
  assertEquals(profileUpdates.some((u) => u.patch.stripe_customer_id === null), true)
  assertEquals(profileUpdates[profileUpdates.length - 1].patch.stripe_customer_id, 'cus_new')
  assertEquals(admin.patches['automation_provisions'].stripe_customer_id, 'cus_new')
})

Deno.test('non-resource_missing Stripe errors are NOT retried', async () => {
  const admin = newAdmin()
  const stripe: SubscriptionStripeCaptured = {}

  let threw = false
  try {
    await handleCreateCheckout(req(), {
      stripe: subscriptionStripe(stripe, { failFirstSessionCreate: { code: 'card_declined', param: 'source' } }),
      createUserClient: fakeUserClient(CONCIERGE, 'coach@example.com', 'cus_stored') as never,
      createAdminClient: fakeAdminClient(admin) as never,
      fulfill: () => Promise.resolve(),
      getEnv,
    })
  } catch {
    threw = true
  }

  assertEquals(threw, true) // other Stripe errors keep their existing behavior
  assertEquals(stripe.allParams!.length, 1) // no blind retry loop
})

Deno.test('trial checkout success_url carries trial=1 for the trial-specific result page', async () => {
  const admin = newAdmin() // first-time subscriber -> trial
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient(CONCIERGE) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  assertEquals(res.status, 200)
  assertEquals(stripe.params!.success_url, 'https://2fronts.de/checkout/result?status=success&trial=1')
})

Deno.test('non-trial checkout success_url does NOT carry trial=1', async () => {
  const admin = newAdmin({
    priorProvisions: [{ id: 'prov-1', automation_requests: { customer_id: 'user-1' } }],
  })
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient(CONCIERGE) as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  assertEquals(res.status, 200)
  assertEquals(stripe.params!.success_url, 'https://2fronts.de/checkout/result?status=success')
})

Deno.test('trial subscription_data still carries request_id metadata for the webhook', async () => {
  const admin = newAdmin() // first-time subscriber
  const stripe: SubscriptionStripeCaptured = {}

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
  const admin = newAdmin({
    // Not a rejected promise: supabase-js normally RESOLVES with { data, error }.
    // This exercises the `if (priorError) throw priorError` branch.
    priorProvisionsResolvedError: new Error('permission denied'),
  })
  const stripe: SubscriptionStripeCaptured = {}

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
  const admin = newAdmin({ priorProvisionsError: new Error('db unavailable') })
  const stripe: SubscriptionStripeCaptured = {}

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
