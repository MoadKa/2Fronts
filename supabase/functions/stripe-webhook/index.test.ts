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
                return { single: () => Promise.resolve({ data: opts.provisionRow, error: opts.provisionRow ? null : new Error('not found') }) }
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
                return {
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
  updates: LifecycleUpdate[]
}
function fakeLifecycleAdminClient(opts: LifecycleOpts) {
  return () => ({
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: () => Promise.resolve({ data: opts.provisionBySub, error: null }),
                // checkout.session.completed path: requires_provisioning lookup.
                single: () => Promise.resolve({ data: { automations: { requires_provisioning: false } }, error: null }),
              }
            },
          }
        },
        update(patch: Record<string, unknown>) {
          const record: LifecycleUpdate = { table, patch, eqs: [] }
          opts.updates.push(record)
          const chain = {
            eq(col: string, val: unknown) {
              record.eqs.push([col, val])
              return chain
            },
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
