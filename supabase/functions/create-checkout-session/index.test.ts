import { assertEquals } from 'jsr:@std/assert@1'
import { handleCreateCheckout } from './index.ts'

interface FakeAutomation {
  name: string
  price_cents: number
  currency: string
  pricing_model?: string
  recurring_interval?: string
  connector_type?: string
  // Defaults to true in the admin fake; a test sets false to delist.
  is_active?: boolean
}

const CONCIERGE: FakeAutomation = { name: 'Concierge', price_cents: 20000, currency: 'eur', pricing_model: 'subscription', recurring_interval: 'month', connector_type: 'booking_concierge' }
const FREE: FakeAutomation = { name: 'Test', price_cents: 0, currency: 'eur' }
const PAID_ONE_TIME: FakeAutomation = { name: 'Paid', price_cents: 49900, currency: 'eur' }

// The request row as the USER client returns it. The automation is no longer
// embedded here: RLS on automations hides a delisted one from a customer, so
// production re-reads it through the admin client (see fakeAdminClient).
function fakeUserClient(
  email = 'coach@example.com',
  stripeCustomerId: string | null = null,
  status = 'requested',
  checkoutSessionId: string | null = null,
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
                      automation_id: 'auto-1',
                      stripe_checkout_session_id: checkoutSessionId,
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
  // The automation the purchase resolves to, read through the ADMIN client
  // (defaults to CONCIERGE; is_active defaults to true).
  automation?: FakeAutomation
  // When true, the automations lookup returns no row at all.
  automationMissing?: boolean
  // When true, the free-path promotion (guarded by .not('status','eq',
  // 'cancelled')) matches zero rows.
  requestCancelled?: boolean
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
            not(...args: unknown[]) {
              record.filters.push(['not', ...args])
              return chain
            },
            // Two guarded writes end in .select() and inspect the affected rows:
            // the free-path promotion on automation_requests (zero rows = the
            // request was cancelled) and the race-guarded profiles persist (zero
            // rows = a concurrent checkout won).
            select: () => {
              if (table === 'automation_requests') {
                return Promise.resolve({ data: captured.requestCancelled ? [] : [{ id: 'req-1' }], error: null })
              }
              return captured.persistError
                ? Promise.resolve({ data: null, error: captured.persistError })
                : Promise.resolve({ data: captured.persistRaceLost ? [] : [{ id: 'user-1' }], error: null })
            },
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
          if (table === 'automations') {
            // The purchased automation, re-read through the admin client so a
            // delisted one still resolves (RLS would hide it from the customer).
            const chain = {
              eq(col: string, val: unknown) {
                record.filters.push(['eq', col, val])
                return chain
              },
              maybeSingle: () =>
                Promise.resolve({
                  data: captured.automationMissing
                    ? null
                    : { is_active: true, ...(captured.automation ?? CONCIERGE) },
                  error: null,
                }),
            }
            return chain
          }
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
  const admin = newAdmin({ automation: FREE })
  let stripeCalled = false
  let fulfilledRequestId: string | null = null

  const res = await handleCreateCheckout(req(), {
    stripe: { checkout: { sessions: { create: () => { stripeCalled = true; return Promise.resolve({ url: 'should-not-happen' }) } } } } as never,
    createUserClient: fakeUserClient() as never,
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

// Delisting an automation CANCELS its in-flight requests. Re-POSTing a
// cancelled one used to sail through the free path and promote it to 'paid',
// so a request the founder had killed came back as a completed purchase. The
// promotion is now guarded exactly like the webhook's and must match nothing.
//
// The read-status guard above catches the plain re-POST first, so what this
// test still pins is the race the promotion guard exists for: the request is
// pre-payment when we read it and cancelled by the time we write.
Deno.test('free path on a cancelled request: promotion matches zero rows -> 409, no fulfillment', async () => {
  const admin = newAdmin({ automation: FREE, requestCancelled: true })
  let fulfillCalled = false

  const res = await handleCreateCheckout(req(), {
    stripe: { checkout: { sessions: { create: () => Promise.reject(new Error('Stripe must not be touched on the free path')) } } } as never,
    createUserClient: fakeUserClient('coach@example.com', null, 'requested') as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => { fulfillCalled = true; return Promise.resolve() },
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 409)
  assertEquals(body.error, 'This request is no longer active')
  assertEquals(fulfillCalled, false) // a cancelled request is never provisioned
})

Deno.test('a request that is already paid returns 409 and never reaches Stripe', async () => {
  const admin = newAdmin({ automation: PAID_ONE_TIME })
  let stripeCalled = false

  const res = await handleCreateCheckout(req(), {
    stripe: { checkout: { sessions: { create: () => { stripeCalled = true; return Promise.resolve({ url: 'should-not-happen' }) } } } } as never,
    createUserClient: fakeUserClient('coach@example.com', null, 'paid') as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.reject(new Error('must not fulfill a completed request again')),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 409)
  assertEquals(body.error, 'Request is no longer payable')
  assertEquals(stripeCalled, false) // no second charge / second subscription
  assertEquals(admin.updates.length, 0) // nothing mutated
})

// A delisted automation can no longer provision, so charging for it would take
// real money for something we cannot deliver. Requests created BEFORE the
// delisting are still sitting in the funnel; without this guard they reach
// Stripe. RLS also hides a delisted row from the customer's own client, which
// is why the check reads through the ADMIN client — a guard on the old
// user-side embed would have seen null and never fired.
Deno.test('delisted automation (is_active false) returns 409 and never reaches Stripe', async () => {
  const admin = newAdmin({ automation: { ...CONCIERGE, is_active: false } })
  let stripeCalled = false

  const res = await handleCreateCheckout(req(), {
    stripe: { checkout: { sessions: { create: () => { stripeCalled = true; return Promise.resolve({ id: 'cs_x', url: 'should-not-happen' }) } } } } as never,
    createUserClient: fakeUserClient() as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.reject(new Error('must not fulfill a delisted automation')),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 409)
  assertEquals(body.error, 'This automation is no longer available')
  assertEquals(stripeCalled, false) // no charge for an undeliverable product
  assertEquals(admin.updates.length, 0) // nothing mutated
})

// The Twilio missed-call connector was retired with the SMS product: its
// getConnector() throws, so a paid request could never provision. The row may
// still be is_active in some environment, so availability is judged on the
// connector type too, not on the flag alone.
Deno.test('retired connector type (twilio_missed_call) returns 409 and never reaches Stripe', async () => {
  const admin = newAdmin({
    // Still flagged active — only the connector type marks it as dead.
    automation: { name: 'Missed Call', price_cents: 9900, currency: 'eur', connector_type: 'twilio_missed_call' },
  })
  let stripeCalled = false

  const res = await handleCreateCheckout(req(), {
    stripe: { checkout: { sessions: { create: () => { stripeCalled = true; return Promise.resolve({ id: 'cs_x', url: 'should-not-happen' }) } } } } as never,
    createUserClient: fakeUserClient() as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.reject(new Error('must not fulfill a retired connector')),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 409)
  assertEquals(body.error, 'This automation is no longer available')
  assertEquals(stripeCalled, false) // a retired connector can never provision
  assertEquals(admin.updates.length, 0)
})

// A request pointing at an automation row that no longer exists (hard-deleted,
// or a bad automation_id) must answer with a JSON 404. Before the null check
// the code dereferenced automation.price_cents and threw a TypeError with no
// CORS headers — the browser saw a network error instead of a message.
Deno.test('missing automation row returns a JSON 404, not a crash', async () => {
  const admin = newAdmin({ automationMissing: true })
  let stripeCalled = false

  const res = await handleCreateCheckout(req(), {
    stripe: { checkout: { sessions: { create: () => { stripeCalled = true; return Promise.resolve({ id: 'cs_x', url: 'should-not-happen' }) } } } } as never,
    createUserClient: fakeUserClient() as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.reject(new Error('must not fulfill an unknown automation')),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 404)
  assertEquals(body.error, 'Automation not found')
  assertEquals(stripeCalled, false)
})

Deno.test('paid one-time automation creates a payment-mode Stripe session and marks payment_pending', async () => {
  const admin = newAdmin({ automation: PAID_ONE_TIME })
  let createdMode: string | undefined
  let createdParams: Record<string, unknown> | undefined

  const res = await handleCreateCheckout(req(), {
    stripe: {
      checkout: { sessions: { create: (params: Record<string, unknown>) => { createdMode = params.mode as string; createdParams = params; return Promise.resolve({ id: 'cs_1', url: 'https://stripe/pay' }) } } },
      customers: { create: () => { throw new Error('customers.create must NOT be called for a one-time automation') } },
    } as never,
    createUserClient: fakeUserClient() as never,
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
  const admin = newAdmin({ automation: { name: 'Concierge', price_cents: 7900, currency: 'eur', pricing_model: 'subscription', recurring_interval: 'month' } })
  let createdParams: Record<string, unknown> | undefined
  let customerEmail: string | undefined

  const res = await handleCreateCheckout(req(), {
    stripe: {
      checkout: { sessions: { create: (params: Record<string, unknown>) => { createdParams = params; return Promise.resolve({ id: 'cs_sub', url: 'https://stripe/subscribe' }) } } },
      customers: { create: (params: { email?: string }) => { customerEmail = params.email; return Promise.resolve({ id: 'cus_123' }) } },
      subscriptions: { list: () => Promise.resolve({ data: [] }) },
    } as never,
    createUserClient: fakeUserClient('coach@example.com') as never,
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
// params (plus session expires and Customer deletes), mints cus_new when
// asked, and lets a test forbid customers.create, stock the Customer's
// Stripe-side subscription history, make the first session create fail (the
// stale-customer retry), or make expire/del fail (best-effort cleanup).
interface SubscriptionStripeCaptured {
  params?: Record<string, unknown>
  allParams?: Record<string, unknown>[]
  listedCustomer?: string
  // Every checkout.sessions.expire call, in order.
  expiredSessionIds?: string[]
  // Every customers.del call, in order.
  deletedCustomerIds?: string[]
}
interface SubscriptionStripeOpts {
  forbidCustomerCreate?: boolean
  // subscriptions.list result for the Customer (default: no history).
  subscriptionsList?: unknown[]
  // When set, subscriptions.list rejects with this error.
  subscriptionsListError?: Error
  // When set, the FIRST checkout.sessions.create throws this; retries succeed.
  failFirstSessionCreate?: unknown
  // When set, checkout.sessions.expire rejects with this error.
  expireError?: Error
  // When set, customers.del rejects with this error.
  customerDelError?: Error
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
        expire: (sessionId: string) => {
          ;(captured.expiredSessionIds ??= []).push(sessionId)
          if (opts.expireError) return Promise.reject(opts.expireError)
          return Promise.resolve({ id: sessionId, status: 'expired' })
        },
      },
    },
    customers: {
      create: () => {
        if (opts.forbidCustomerCreate) throw new Error('customers.create must NOT be called when a stripe_customer_id is stored')
        return Promise.resolve({ id: 'cus_new' })
      },
      del: (customerId: string) => {
        ;(captured.deletedCustomerIds ??= []).push(customerId)
        if (opts.customerDelError) return Promise.reject(opts.customerDelError)
        return Promise.resolve({ id: customerId, deleted: true })
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

Deno.test('first-time subscriber gets a 14-day trial on the subscription', async () => {
  const admin = newAdmin() // no prior provisions
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient() as never,
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
    createUserClient: fakeUserClient() as never,
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
    createUserClient: fakeUserClient() as never,
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
    createUserClient: fakeUserClient('coach@example.com', 'cus_stored') as never,
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
    createUserClient: fakeUserClient() as never,
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
    createUserClient: fakeUserClient() as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  assertEquals(res.status, 200)
  // Not cus_new (the id this request minted): both checkouts converge on the
  // winner's Customer so the coach ends up with exactly one.
  assertEquals(stripe.params!.customer, 'cus_winner')
  assertEquals(admin.patches['automation_provisions'].stripe_customer_id, 'cus_winner')
  // The loser's freshly minted Customer is deleted so it doesn't linger in
  // Stripe as an empty duplicate.
  assertEquals(stripe.deletedCustomerIds, ['cus_new'])
})

Deno.test('orphan Customer delete failure is ignored: winner still used, checkout succeeds', async () => {
  const admin = newAdmin({ persistRaceLost: true, raceWinnerCustomerId: 'cus_winner' })
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe, { customerDelError: new Error('stripe down') }),
    createUserClient: fakeUserClient() as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200) // cleanup is hygiene, never a checkout blocker
  assertEquals(body.url, 'https://stripe/subscribe')
  assertEquals(stripe.params!.customer, 'cus_winner')
  assertEquals(stripe.deletedCustomerIds, ['cus_new']) // the delete was attempted
})

Deno.test('persist error: checkout still succeeds with the freshly created Customer', async () => {
  const admin = newAdmin({ persistError: new Error('db unavailable') })
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient() as never,
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
    createUserClient: fakeUserClient('coach@example.com', 'cus_stored') as never,
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
    createUserClient: fakeUserClient('coach@example.com', 'cus_stored') as never,
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
    createUserClient: fakeUserClient('coach@example.com', 'cus_stored') as never,
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
    createUserClient: fakeUserClient() as never,
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
    createUserClient: fakeUserClient() as never,
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
    createUserClient: fakeUserClient('coach@example.com', 'cus_stale') as never,
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

Deno.test('replay with a live session: the old session is expired before the new one is created and stored', async () => {
  const admin = newAdmin()
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    // A previous checkout already left this request payment_pending with a
    // stored (still payable) session.
    createUserClient: fakeUserClient('coach@example.com', null, 'payment_pending', 'cs_old') as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200)
  assertEquals(body.url, 'https://stripe/subscribe')
  // At most one live session per request: the old one is dead before the new
  // one exists, so the webhook's session-id guard always matches the stored id.
  assertEquals(stripe.expiredSessionIds, ['cs_old'])
  assertEquals(admin.patches['automation_requests'].stripe_checkout_session_id, 'cs_sub')
})

Deno.test('expiring the old session fails (already expired/completed): checkout still proceeds', async () => {
  const admin = newAdmin()
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe, { expireError: new Error('session already expired') }),
    createUserClient: fakeUserClient('coach@example.com', null, 'payment_pending', 'cs_old') as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200) // best-effort: a dead session can't race anyway
  assertEquals(body.url, 'https://stripe/subscribe')
  assertEquals(stripe.expiredSessionIds, ['cs_old']) // the expire was attempted
  assertEquals(admin.patches['automation_requests'].stripe_checkout_session_id, 'cs_sub')
})

Deno.test('a first checkout (no stored session id) never calls sessions.expire', async () => {
  const admin = newAdmin()
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe),
    createUserClient: fakeUserClient() as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  assertEquals(res.status, 200)
  assertEquals(stripe.expiredSessionIds, undefined)
})

Deno.test('stale-customer retry loses the persist race: the winner\'s id is used for the retried session and the orphan deleted', async () => {
  const admin = newAdmin({ persistRaceLost: true, raceWinnerCustomerId: 'cus_winner' })
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe, {
      failFirstSessionCreate: { code: 'resource_missing', param: 'customer' },
    }),
    createUserClient: fakeUserClient('coach@example.com', 'cus_stale') as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  const body = await res.json()
  assertEquals(res.status, 200)
  assertEquals(body.url, 'https://stripe/subscribe')
  assertEquals(stripe.allParams!.length, 2)
  assertEquals(stripe.allParams![0].customer, 'cus_stale')
  // Between clearing the stale id and persisting the fresh one, a concurrent
  // checkout stored its Customer: the retry converges on that winner instead
  // of splitting the coach across two Customers.
  assertEquals(stripe.allParams![1].customer, 'cus_winner')
  assertEquals(stripe.deletedCustomerIds, ['cus_new']) // this request's orphan cleaned up
  assertEquals(admin.patches['automation_provisions'].stripe_customer_id, 'cus_winner')
})

Deno.test('Stripe history of only incomplete/incomplete_expired subscriptions still earns the trial', async () => {
  const admin = newAdmin() // DB: first-time subscriber
  const stripe: SubscriptionStripeCaptured = {}

  const res = await handleCreateCheckout(req(), {
    stripe: subscriptionStripe(stripe, {
      forbidCustomerCreate: true,
      // Abandoned checkouts leave incomplete subscriptions behind; neither
      // status ever activated anything, so they must not veto the trial.
      subscriptionsList: [
        { id: 'sub_i', status: 'incomplete' },
        { id: 'sub_ie', status: 'incomplete_expired' },
      ],
    }),
    createUserClient: fakeUserClient('coach@example.com', 'cus_stored') as never,
    createAdminClient: fakeAdminClient(admin) as never,
    fulfill: () => Promise.resolve(),
    getEnv,
  })

  assertEquals(res.status, 200)
  assertEquals(stripe.listedCustomer, 'cus_stored')
  const subData = stripe.params!.subscription_data as { trial_period_days?: number }
  assertEquals(subData.trial_period_days, 14) // never-activated history is not history
})

Deno.test('non-resource_missing Stripe errors are NOT retried', async () => {
  const admin = newAdmin()
  const stripe: SubscriptionStripeCaptured = {}

  let threw = false
  try {
    await handleCreateCheckout(req(), {
      stripe: subscriptionStripe(stripe, { failFirstSessionCreate: { code: 'card_declined', param: 'source' } }),
      createUserClient: fakeUserClient('coach@example.com', 'cus_stored') as never,
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
    createUserClient: fakeUserClient() as never,
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
    createUserClient: fakeUserClient() as never,
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
    createUserClient: fakeUserClient() as never,
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
    createUserClient: fakeUserClient() as never,
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
    createUserClient: fakeUserClient() as never,
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
