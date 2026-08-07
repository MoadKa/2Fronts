import { assertEquals } from 'jsr:@std/assert@1'
import { provisionIfNeeded } from './provisionFulfillment.ts'

// provisionIfNeeded is the shared post-payment fulfillment path: the
// stripe-webhook calls it on a paid session and create-checkout-session calls it
// on a free (0-amount) automation. It had no direct test until the SMS product
// was removed on 2026-08-07, which is when its most important property appeared:
// it must never throw, because a throw becomes a non-2xx from the Stripe webhook
// and Stripe then redelivers that event forever.

interface FakeOpts {
  requestRow: { automations: { requires_provisioning: boolean } } | null
  provisionRow: Record<string, unknown> | null
  updates: { patch: unknown; matchedStatus?: string }[]
  // Whether the status-guarded claim UPDATE matches a row. false simulates a
  // concurrent caller having already claimed it (redelivered Stripe event).
  claimSucceeds?: boolean
}

function fakeAdminClient(opts: FakeOpts) {
  return {
    from(table: string) {
      if (table === 'automation_requests') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: opts.requestRow,
                  error: opts.requestRow ? null : new Error('not found'),
                }),
            }),
          }),
        }
      }
      if (table === 'automation_provisions') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: opts.provisionRow,
                  error: opts.provisionRow ? null : new Error('not found'),
                }),
            }),
          }),
          update(patch: unknown) {
            const record: { patch: unknown; matchedStatus?: string } = { patch }
            opts.updates.push(record)
            const builder = {
              eq(col: string, val: unknown) {
                if (col === 'status') record.matchedStatus = val as string
                return builder
              },
              select: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: opts.claimSucceeds === false ? null : { ...opts.provisionRow },
                    error: null,
                  }),
              }),
              then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
            }
            return builder
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

Deno.test('returns without touching provisions when the automation does not require provisioning', async () => {
  const opts: FakeOpts = {
    requestRow: { automations: { requires_provisioning: false } },
    provisionRow: null,
    updates: [],
  }

  await provisionIfNeeded(fakeAdminClient(opts) as never, 'req-1')

  assertEquals(opts.updates.length, 0)
})

Deno.test('returns quietly when the request has no provision row', async () => {
  const opts: FakeOpts = {
    requestRow: { automations: { requires_provisioning: true } },
    provisionRow: null,
    updates: [],
  }

  // No throw is the assertion: a missing row is handled upstream by the
  // webhook's self-heal insert, not by exploding here.
  await provisionIfNeeded(fakeAdminClient(opts) as never, 'req-1')

  assertEquals(opts.updates.length, 0)
})

Deno.test('marks the provision failed instead of throwing when the connector is retired', async () => {
  const opts: FakeOpts = {
    requestRow: { automations: { requires_provisioning: true } },
    provisionRow: {
      id: 'prov-1',
      connector_type: 'twilio_missed_call',
      business_name: 'Acme Plumbing',
      status: 'pending',
    },
    updates: [],
  }

  await provisionIfNeeded(fakeAdminClient(opts) as never, 'req-1')

  assertEquals(opts.updates.length, 1)
  assertEquals((opts.updates[0].patch as { status: string }).status, 'failed')
})

Deno.test('marks the provision failed instead of throwing when connector_type is null (legacy row)', async () => {
  const opts: FakeOpts = {
    requestRow: { automations: { requires_provisioning: true } },
    provisionRow: {
      id: 'prov-legacy',
      connector_type: null,
      business_name: 'Acme Plumbing',
      status: 'pending',
    },
    updates: [],
  }

  await provisionIfNeeded(fakeAdminClient(opts) as never, 'req-1')

  assertEquals(opts.updates.length, 1)
  assertEquals((opts.updates[0].patch as { status: string }).status, 'failed')
})

Deno.test('claims the row from pending, dispatches, and persists active', async () => {
  const opts: FakeOpts = {
    requestRow: { automations: { requires_provisioning: true } },
    provisionRow: {
      id: 'prov-2',
      connector_type: 'booking_concierge',
      business_name: 'Acme Coaching',
      status: 'pending',
    },
    updates: [],
    claimSucceeds: true,
  }

  await provisionIfNeeded(fakeAdminClient(opts) as never, 'req-1')

  // Two writes: the status-guarded claim, then the outcome. Asserting the
  // claim's guard is what proves dispatch actually happened — a pure
  // "nothing was marked failed" assertion would also pass if the dispatch
  // line were deleted outright.
  assertEquals(opts.updates.length, 2)
  assertEquals((opts.updates[0].patch as { status: string }).status, 'provisioning')
  assertEquals(opts.updates[0].matchedStatus, 'pending')
  assertEquals((opts.updates[1].patch as { status: string }).status, 'active')
})

Deno.test('does not re-run fulfillment when another delivery already claimed the row', async () => {
  const opts: FakeOpts = {
    requestRow: { automations: { requires_provisioning: true } },
    provisionRow: {
      id: 'prov-2',
      connector_type: 'booking_concierge',
      business_name: 'Acme Coaching',
      status: 'pending',
    },
    updates: [],
    claimSucceeds: false,
  }

  await provisionIfNeeded(fakeAdminClient(opts) as never, 'req-1')

  // Only the failed claim attempt. No outcome write, because this delivery
  // never held the claim. This is the Stripe-redelivery idempotency guarantee.
  assertEquals(opts.updates.length, 1)
  assertEquals((opts.updates[0].patch as { status: string }).status, 'provisioning')
})
