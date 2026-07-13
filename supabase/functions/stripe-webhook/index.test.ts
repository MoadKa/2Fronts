import { assertEquals } from 'jsr:@std/assert@1'
import { handleStripeWebhook, type ProvisionAutomation } from './index.ts'

// Default no-op alert for tests that don't exercise alerting. Returns false
// (the "alerting not configured" result), matching the shared module's no-op.
const noopAlert = () => Promise.resolve(false)

function fakeStripe(event: unknown, shouldThrow = false) {
  return {
    webhooks: {
      constructEventAsync: () => {
        if (shouldThrow) throw new Error('invalid signature')
        return Promise.resolve(event)
      },
    },
  }
}

interface CapturedAdminCall {
  table?: string
  patch?: unknown
  eqCalls: [string, unknown][]
}

function fakeAdminClient(captured: CapturedAdminCall) {
  return () => ({
    from(table: string) {
      captured.table = table
      return {
        update(patch: unknown) {
          captured.patch = patch
          const chain = {
            eq(col: string, val: unknown) {
              captured.eqCalls.push([col, val])
              return chain
            },
          }
          return chain
        },
        // provisionIfNeeded always runs after a paid update; these tests don't
        // care about provisioning, so make the select() resolve to "automation
        // doesn't require provisioning" and bail out immediately.
        select() {
          return { eq: () => ({ single: () => Promise.resolve({ data: { automations: { requires_provisioning: false } }, error: null }) }) }
        },
      }
    },
  })
}

interface ProvisionRow {
  id: string
  request_id: string
  business_name: string
  booking_link: string
  status: string
  requires_provisioning?: boolean
}

interface FakeProvisioningAdminClientOpts {
  requestRow: { automations: { requires_provisioning: boolean } } | null
  provisionRow: ProvisionRow | null
  claimSucceeds: boolean
  updates: { table: string; patch: unknown; matchedStatus?: string }[]
}

function fakeProvisioningAdminClient(opts: FakeProvisioningAdminClientOpts) {
  return () => ({
    from(table: string) {
      if (table === 'automation_requests') {
        return {
          select() {
            return {
              eq() {
                return { single: () => Promise.resolve({ data: opts.requestRow, error: opts.requestRow ? null : new Error('not found') }) }
              },
            }
          },
          update(patch: unknown) {
            opts.updates.push({ table, patch })
            const chain = { eq: () => chain }
            return chain
          },
        }
      }
      if (table === 'automation_provisions') {
        return {
          select() {
            return {
              eq() {
                return {
                  single: () => Promise.resolve({ data: opts.provisionRow, error: opts.provisionRow ? null : new Error('not found') }),
                  // The subscription-id guard pre-reads the provision by
                  // request_id before updating it.
                  maybeSingle: () => Promise.resolve({ data: opts.provisionRow ?? null, error: null }),
                }
              },
            }
          },
          update(patch: unknown) {
            const record: { table: string; patch: unknown; matchedStatus?: string } = { table, patch }
            opts.updates.push(record)
            const builder = {
              eq(col: string, val: unknown) {
                if (col === 'status') record.matchedStatus = val as string
                return builder
              },
              select() {
                // Awaited directly by the subscription-id store (affected-rows
                // check) AND chained with .maybeSingle() by the provisioning
                // claim — mirror supabase-js, where the builder is a thenable.
                const affectedRows = Promise.resolve({
                  data: opts.provisionRow ? [{ ...opts.provisionRow, ...(patch as object) }] : [],
                  error: null,
                })
                return {
                  then: affectedRows.then.bind(affectedRows),
                  maybeSingle: () =>
                    Promise.resolve({
                      data: opts.claimSucceeds ? { ...opts.provisionRow, ...(patch as object) } : null,
                      error: null,
                    }),
                }
              },
            }
            return builder
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  })
}

Deno.test('returns 400 and does not touch the DB when the Stripe signature is invalid', async () => {
  const captured: CapturedAdminCall = { eqCalls: [] }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(null, true) as never,
    createAdminClient: fakeAdminClient(captured) as never,
    alert: noopAlert,
    provisionAutomation: { purchaseNumber: () => Promise.reject(new Error('not used in this test')) } as ProvisionAutomation,
  })

  assertEquals(res.status, 400)
  assertEquals(captured.table, undefined)
})

Deno.test('marks the request paid when checkout.session.completed arrives with a request_id', async () => {
  const captured: CapturedAdminCall = { eqCalls: [] }
  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_123', metadata: { request_id: 'req_abc' } } },
  }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeAdminClient(captured) as never,
    alert: noopAlert,
    provisionAutomation: { purchaseNumber: () => Promise.reject(new Error('not used in this test')) } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  assertEquals(captured.table, 'automation_requests')
  assertEquals((captured.patch as { status: string }).status, 'paid')
  assertEquals(captured.eqCalls[0], ['id', 'req_abc'])
  assertEquals(captured.eqCalls[1], ['stripe_checkout_session_id', 'cs_123'])
})

Deno.test('returns 200 and skips the DB update when checkout.session.completed has no request_id', async () => {
  const captured: CapturedAdminCall = { eqCalls: [] }
  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_123', metadata: {} } },
  }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeAdminClient(captured) as never,
    alert: noopAlert,
    provisionAutomation: { purchaseNumber: () => Promise.reject(new Error('not used in this test')) } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  assertEquals(captured.table, undefined)
})

Deno.test('returns 200 and does nothing for unrelated event types', async () => {
  const captured: CapturedAdminCall = { eqCalls: [] }
  const event = { type: 'payment_intent.created', data: { object: {} } }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeAdminClient(captured) as never,
    alert: noopAlert,
    provisionAutomation: { purchaseNumber: () => Promise.reject(new Error('not used in this test')) } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  assertEquals(captured.table, undefined)
})

Deno.test('provisions a Twilio number when the automation requires provisioning and the claim succeeds', async () => {
  const opts: FakeProvisioningAdminClientOpts = {
    requestRow: { automations: { requires_provisioning: true } },
    provisionRow: { id: 'prov-1', request_id: 'req_abc', business_name: 'Acme Plumbing', booking_link: 'https://cal.com/acme', status: 'pending' },
    claimSucceeds: true,
    updates: [],
  }
  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_123', metadata: { request_id: 'req_abc' } } },
  }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })
  let purchaseCalledWith = ''

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeProvisioningAdminClient(opts) as never,
    alert: noopAlert,
    provisionAutomation: {
      purchaseNumber: (businessName: string) => {
        purchaseCalledWith = businessName
        return Promise.resolve({ phoneNumber: '+4915712345678', sid: 'PN123' })
      },
    } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  assertEquals(purchaseCalledWith, 'Acme Plumbing')
  const provisionUpdates = opts.updates.filter((u) => u.table === 'automation_provisions')
  assertEquals(provisionUpdates[0].matchedStatus, 'pending')
  assertEquals((provisionUpdates[0].patch as { status: string }).status, 'provisioning')
  assertEquals((provisionUpdates[1].patch as { status: string; twilio_phone_number: string }).status, 'active')
  assertEquals((provisionUpdates[1].patch as { twilio_phone_number: string }).twilio_phone_number, '+4915712345678')
})

Deno.test('skips provisioning (no duplicate purchase) when the claim fails because another delivery already claimed it', async () => {
  const opts: FakeProvisioningAdminClientOpts = {
    requestRow: { automations: { requires_provisioning: true } },
    provisionRow: { id: 'prov-1', request_id: 'req_abc', business_name: 'Acme Plumbing', booking_link: 'https://cal.com/acme', status: 'pending' },
    claimSucceeds: false,
    updates: [],
  }
  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_123', metadata: { request_id: 'req_abc' } } },
  }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })
  let purchaseWasCalled = false

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeProvisioningAdminClient(opts) as never,
    alert: noopAlert,
    provisionAutomation: {
      purchaseNumber: () => {
        purchaseWasCalled = true
        return Promise.resolve({ phoneNumber: '+4915712345678', sid: 'PN123' })
      },
    } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  assertEquals(purchaseWasCalled, false)
})

Deno.test('marks the provision failed (not stuck pending) when the Twilio purchase throws', async () => {
  const opts: FakeProvisioningAdminClientOpts = {
    requestRow: { automations: { requires_provisioning: true } },
    provisionRow: { id: 'prov-1', request_id: 'req_abc', business_name: 'Acme Plumbing', booking_link: 'https://cal.com/acme', status: 'pending' },
    claimSucceeds: true,
    updates: [],
  }
  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_123', metadata: { request_id: 'req_abc' } } },
  }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeProvisioningAdminClient(opts) as never,
    alert: noopAlert,
    provisionAutomation: {
      purchaseNumber: () => Promise.reject(new Error('Twilio account suspended')),
    } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  const provisionUpdates = opts.updates.filter((u) => u.table === 'automation_provisions')
  assertEquals((provisionUpdates[1].patch as { status: string }).status, 'failed')
})

Deno.test('does not attempt provisioning when the automation does not require it', async () => {
  const opts: FakeProvisioningAdminClientOpts = {
    requestRow: { automations: { requires_provisioning: false } },
    provisionRow: null,
    claimSucceeds: false,
    updates: [],
  }
  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_123', metadata: { request_id: 'req_abc' } } },
  }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })
  let purchaseWasCalled = false

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeProvisioningAdminClient(opts) as never,
    alert: noopAlert,
    provisionAutomation: {
      purchaseNumber: () => {
        purchaseWasCalled = true
        return Promise.resolve({ phoneNumber: '+4915712345678', sid: 'PN123' })
      },
    } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  assertEquals(purchaseWasCalled, false)
})

// --- Subscription lifecycle (#25) -------------------------------------------

// Records every update across tables (and the eq filters) so subscription tests
// can assert the concierge deactivation + provision writes. Supports the select
// -> eq -> maybeSingle path deactivateSubscription uses to find the provision.
interface LifecycleUpdate {
  table: string
  patch: Record<string, unknown>
  eqs: [string, unknown][]
}
interface LifecycleOpts {
  // The provision returned when looking it up by stripe_subscription_id.
  provisionBySub: { id: string; config: Record<string, unknown> } | null
  // The provision returned when the completed handler pre-reads it by
  // request_id (subscription-id store guard). Default: a plain pending row.
  provisionByRequest?: { id: string; stripe_subscription_id: string | null } | null
  updates: LifecycleUpdate[]
  // Every insert in order (the provision_missing self-heal path).
  inserts?: { table: string; row: Record<string, unknown> }[]
  // When set, inserts resolve with this error in the { error } envelope.
  insertError?: Error
  // What the automation_requests join select returns (self-heal connector_type
  // derivation + the requires_provisioning lookup share it).
  requestAutomation?: Record<string, unknown>
}
function fakeLifecycleAdminClient(opts: LifecycleOpts) {
  const provisionByRequest = opts.provisionByRequest === undefined
    ? { id: 'prov-1', stripe_subscription_id: null }
    : opts.provisionByRequest
  return () => ({
    from(table: string) {
      return {
        select() {
          return {
            eq(col: string) {
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: col === 'request_id' ? provisionByRequest : opts.provisionBySub,
                    error: null,
                  }),
                // checkout.session.completed path: requires_provisioning lookup
                // and the self-heal's connector_type derivation.
                single: () =>
                  Promise.resolve({
                    data: { automations: opts.requestAutomation ?? { requires_provisioning: false } },
                    error: null,
                  }),
              }
            },
          }
        },
        insert(row: Record<string, unknown>) {
          ;(opts.inserts ??= []).push({ table, row })
          return Promise.resolve({ error: opts.insertError ?? null })
        },
        update(patch: Record<string, unknown>) {
          const record: LifecycleUpdate = { table, patch, eqs: [] }
          opts.updates.push(record)
          const chain = {
            eq(col: string, val: unknown) {
              record.eqs.push([col, val])
              return chain
            },
            // Affected-rows check on the subscription-id store: matches the
            // pre-read row when it exists, zero rows when it doesn't.
            select: () =>
              Promise.resolve({
                data: provisionByRequest ? [{ ...provisionByRequest, ...patch }] : [],
                error: null,
              }),
          }
          return chain
        },
      }
    },
  })
}

Deno.test('checkout.session.completed (subscription) stores stripe_subscription_id + customer on the provision', async () => {
  const opts: LifecycleOpts = { provisionBySub: null, updates: [] }
  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_sub', subscription: 'sub_123', customer: 'cus_123', metadata: { request_id: 'req_abc' } } },
  }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeLifecycleAdminClient(opts) as never,
    alert: noopAlert,
    provisionAutomation: { purchaseNumber: () => Promise.reject(new Error('unused')) } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  const provUpdate = opts.updates.find((u) => u.table === 'automation_provisions' && 'stripe_subscription_id' in u.patch)
  assertEquals(provUpdate?.patch.stripe_subscription_id, 'sub_123')
  assertEquals(provUpdate?.patch.stripe_customer_id, 'cus_123')
  assertEquals(provUpdate?.eqs[0], ['request_id', 'req_abc'])
})

Deno.test('a provision already carrying a DIFFERENT subscription id is not overwritten: subscription_conflict alert instead', async () => {
  const opts: LifecycleOpts = {
    provisionBySub: null,
    // A subscription is already tracked for this request.
    provisionByRequest: { id: 'prov-1', stripe_subscription_id: 'sub_old' },
    updates: [],
  }
  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_sub2', subscription: 'sub_new', customer: 'cus_123', metadata: { request_id: 'req_abc' } } },
  }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })
  const alerts: { type: string; fields?: Record<string, unknown> }[] = []

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeLifecycleAdminClient(opts) as never,
    alert: (e) => { alerts.push(e as (typeof alerts)[number]); return Promise.resolve(true) },
    provisionAutomation: { purchaseNumber: () => Promise.reject(new Error('unused')) } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  // sub_old stays: overwriting would orphan it (its cancellation event could
  // no longer find this provision).
  const provUpdate = opts.updates.find((u) => u.table === 'automation_provisions' && 'stripe_subscription_id' in u.patch)
  assertEquals(provUpdate, undefined)
  assertEquals(alerts.length, 1)
  assertEquals(alerts[0].type, 'subscription_conflict')
  assertEquals(alerts[0].fields?.storedSubscriptionId, 'sub_old')
  assertEquals(alerts[0].fields?.incomingSubscriptionId, 'sub_new')
})

Deno.test('re-delivery with the SAME subscription id stores it again without a conflict alert', async () => {
  const opts: LifecycleOpts = {
    provisionBySub: null,
    provisionByRequest: { id: 'prov-1', stripe_subscription_id: 'sub_123' },
    updates: [],
  }
  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_sub', subscription: 'sub_123', customer: 'cus_123', metadata: { request_id: 'req_abc' } } },
  }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })
  const alerts: { type: string }[] = []

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeLifecycleAdminClient(opts) as never,
    alert: (e) => { alerts.push(e as (typeof alerts)[number]); return Promise.resolve(true) },
    provisionAutomation: { purchaseNumber: () => Promise.reject(new Error('unused')) } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  const provUpdate = opts.updates.find((u) => u.table === 'automation_provisions' && 'stripe_subscription_id' in u.patch)
  assertEquals(provUpdate?.patch.stripe_subscription_id, 'sub_123') // idempotent re-store
  assertEquals(alerts.length, 0)
})

Deno.test('missing provision row is self-healed with a minimal pending insert AND still alerts provision_missing', async () => {
  const opts: LifecycleOpts = {
    provisionBySub: null,
    provisionByRequest: null,
    updates: [],
    inserts: [],
    requestAutomation: { requires_provisioning: false, connector_type: 'booking_concierge' },
  }
  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_sub', subscription: 'sub_123', customer: 'cus_123', metadata: { request_id: 'req_abc' } } },
  }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })
  const alerts: { type: string; fields?: Record<string, unknown> }[] = []

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeLifecycleAdminClient(opts) as never,
    alert: (e) => { alerts.push(e as (typeof alerts)[number]); return Promise.resolve(true) },
    provisionAutomation: { purchaseNumber: () => Promise.reject(new Error('unused')) } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  // The hole is closed server-side: the live subscription is tracked again, so
  // its cancellation event can find the provision.
  const insert = opts.inserts!.find((i) => i.table === 'automation_provisions')
  assertEquals(insert !== undefined, true)
  assertEquals(insert!.row.request_id, 'req_abc')
  assertEquals(insert!.row.status, 'pending')
  assertEquals(insert!.row.stripe_subscription_id, 'sub_123')
  assertEquals(insert!.row.stripe_customer_id, 'cus_123')
  assertEquals(insert!.row.connector_type, 'booking_concierge') // derived from the automation
  // A skipped upstream insert is still a state a human should know about.
  assertEquals(alerts.length, 1)
  assertEquals(alerts[0].type, 'provision_missing')
  assertEquals(alerts[0].fields?.requestId, 'req_abc')
  assertEquals(alerts[0].fields?.subscriptionId, 'sub_123')
  assertEquals(alerts[0].fields?.selfHealed, true)
})

Deno.test('self-heal insert failure (e.g. unique race) still returns 200 and alerts provision_missing', async () => {
  const opts: LifecycleOpts = {
    provisionBySub: null,
    provisionByRequest: null,
    updates: [],
    inserts: [],
    insertError: new Error('duplicate key value violates unique constraint'),
  }
  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_sub', subscription: 'sub_123', customer: 'cus_123', metadata: { request_id: 'req_abc' } } },
  }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })
  const alerts: { type: string; fields?: Record<string, unknown> }[] = []

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeLifecycleAdminClient(opts) as never,
    alert: (e) => { alerts.push(e as (typeof alerts)[number]); return Promise.resolve(true) },
    provisionAutomation: { purchaseNumber: () => Promise.reject(new Error('unused')) } as ProvisionAutomation,
  })

  assertEquals(res.status, 200) // Stripe must get its 200 either way
  assertEquals(opts.inserts!.length, 1) // the insert was attempted
  assertEquals(alerts.length, 1) // the alert is kept when the heal fails
  assertEquals(alerts[0].type, 'provision_missing')
  assertEquals(alerts[0].fields?.selfHealed, false)
})

Deno.test('trial-shaped checkout.session.completed (no payment yet) still marks paid, stores the subscription id, and provisions', async () => {
  // A 14-day-trial checkout completes with nothing charged: Stripe sends
  // payment_status 'no_payment_required' and amount_total 0, but the
  // subscription exists and the concierge must go live NOW — the coach paid
  // with their card details, not money. This pins that intended behavior.
  const opts: FakeProvisioningAdminClientOpts = {
    requestRow: { automations: { requires_provisioning: true } },
    provisionRow: { id: 'prov-1', request_id: 'req_abc', business_name: 'Acme Coaching', booking_link: 'https://cal.com/acme', status: 'pending' },
    claimSucceeds: true,
    updates: [],
  }
  const event = {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_trial',
        payment_status: 'no_payment_required',
        amount_total: 0,
        subscription: 'sub_trial',
        customer: 'cus_123',
        metadata: { request_id: 'req_abc' },
      },
    },
  }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })
  let purchaseCalledWith = ''

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeProvisioningAdminClient(opts) as never,
    alert: noopAlert,
    provisionAutomation: {
      purchaseNumber: (businessName: string) => {
        purchaseCalledWith = businessName
        return Promise.resolve({ phoneNumber: '+4915712345678', sid: 'PN123' })
      },
    } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  // Request marked paid even though 0 € moved.
  const requestUpdate = opts.updates.find((u) => u.table === 'automation_requests')
  assertEquals((requestUpdate?.patch as { status: string }).status, 'paid')
  // Subscription id stored so cancellation can find the provision later.
  const subStore = opts.updates.find(
    (u) => u.table === 'automation_provisions' && 'stripe_subscription_id' in (u.patch as Record<string, unknown>),
  )
  assertEquals((subStore?.patch as { stripe_subscription_id: string }).stripe_subscription_id, 'sub_trial')
  assertEquals((subStore?.patch as { stripe_customer_id: string }).stripe_customer_id, 'cus_123')
  // Provisioning ran: the concierge goes live at trial start, not at first charge.
  assertEquals(purchaseCalledWith, 'Acme Coaching')
})

Deno.test('customer.subscription.deleted deactivates the linked concierge and cancels the provision', async () => {
  const opts: LifecycleOpts = {
    provisionBySub: { id: 'prov-9', config: { concierge_id: 'con-1' } },
    updates: [],
  }
  const event = { type: 'customer.subscription.deleted', data: { object: { id: 'sub_123' } } }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeLifecycleAdminClient(opts) as never,
    alert: noopAlert,
    provisionAutomation: { purchaseNumber: () => Promise.reject(new Error('unused')) } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  const conciergeUpdate = opts.updates.find((u) => u.table === 'concierges')
  assertEquals(conciergeUpdate?.patch.is_active, false)
  assertEquals(conciergeUpdate?.eqs[0], ['id', 'con-1'])
  const provUpdate = opts.updates.find((u) => u.table === 'automation_provisions')
  assertEquals(provUpdate?.patch.status, 'cancelled')
  assertEquals(provUpdate?.eqs[0], ['id', 'prov-9'])
})

Deno.test('customer.subscription.deleted is idempotent: re-delivery for an unknown subscription is a safe no-op', async () => {
  // No provision matches the subscription id (e.g. already processed/unknown).
  const opts: LifecycleOpts = { provisionBySub: null, updates: [] }
  const event = { type: 'customer.subscription.deleted', data: { object: { id: 'sub_gone' } } }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeLifecycleAdminClient(opts) as never,
    alert: noopAlert,
    provisionAutomation: { purchaseNumber: () => Promise.reject(new Error('unused')) } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  assertEquals(opts.updates.length, 0) // nothing deactivated, no error
})

Deno.test('invoice.payment_failed sends an alert via the alert dependency', async () => {
  const opts: LifecycleOpts = { provisionBySub: null, updates: [] }
  const event = {
    type: 'invoice.payment_failed',
    data: { object: { id: 'in_1', subscription: 'sub_123', customer: 'cus_123', amount_due: 7900 } },
  }
  const req = new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' })
  let alerted: { type: string; fields?: Record<string, unknown> } | null = null

  const res = await handleStripeWebhook(req, {
    stripe: fakeStripe(event) as never,
    createAdminClient: fakeLifecycleAdminClient(opts) as never,
    alert: (e) => { alerted = e as typeof alerted; return Promise.resolve(true) },
    provisionAutomation: { purchaseNumber: () => Promise.reject(new Error('unused')) } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  assertEquals(alerted!.type, 'subscription_payment_failed')
  assertEquals(alerted!.fields?.subscriptionId, 'sub_123')
  // payment_failed alerts but does NOT deactivate (Stripe retries first).
  assertEquals(opts.updates.length, 0)
})
