import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { provisionIfNeeded } from './provisionFulfillment.ts'

// provisionIfNeeded is the shared post-payment fulfillment path: the
// stripe-webhook calls it on a paid session and create-checkout-session calls it
// on a free (0-amount) automation. It had no direct test until the SMS product
// was removed on 2026-08-07, which is when its most important property appeared:
// it must never throw, because a throw becomes a non-2xx from the Stripe webhook
// and Stripe then redelivers that event forever.

// A PostgREST error as supabase-js surfaces it: `.code` is what production
// branches on, so the fake must carry one. PGRST116 is `.single()`'s "no rows".
interface FakePostgrestError {
  code?: string
  message: string
}

const NO_ROWS: FakePostgrestError = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }

interface FakeOpts {
  // The automation join is the DISPATCH SOURCE for connector_type; the provision
  // column is only a fallback (see provisionFulfillment.ts).
  requestRow: { automations: { requires_provisioning: boolean; connector_type?: string | null } } | null
  // Non-null makes the request lookup fail. Defaults to "no rows" when
  // requestRow is null.
  requestError?: FakePostgrestError | null
  provisionRow: Record<string, unknown> | null
  // Non-null makes the provision lookup fail. Defaults to PGRST116 when
  // provisionRow is null, because that is what `.single()` actually returns for
  // a missing row and production only tolerates that one code.
  provisionError?: FakePostgrestError | null
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
                  error: opts.requestError ?? (opts.requestRow ? null : NO_ROWS),
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
                  error: opts.provisionError ?? (opts.provisionRow ? null : NO_ROWS),
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
              // The retired-connector failure write guards on a set of statuses
              // rather than a single one.
              in(col: string, vals: unknown[]) {
                if (col === 'status') record.matchedStatus = (vals as string[]).join('|')
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
    requestRow: { automations: { requires_provisioning: true, connector_type: 'booking_concierge' } },
    provisionRow: null,
    // PGRST116 specifically: production distinguishes "no rows" (a legitimate
    // state) from a real DB failure, so a generic Error here would be a lie
    // about what Postgres said.
    updates: [],
  }

  // No throw is the assertion: a missing row is handled upstream by the
  // webhook's self-heal insert, not by exploding here.
  await provisionIfNeeded(fakeAdminClient(opts) as never, 'req-1')

  assertEquals(opts.updates.length, 0)
})

// Pins the throw-on-transient-failure rule. A swallowed provision-lookup error
// answers 200 to Stripe, so the event is never redelivered and a PAID request
// silently never provisions — no 'failed' status, no trace.
Deno.test('throws when the provision lookup fails for a reason other than "no rows"', async () => {
  const opts: FakeOpts = {
    requestRow: { automations: { requires_provisioning: true, connector_type: 'booking_concierge' } },
    provisionRow: null,
    provisionError: { code: '57014', message: 'canceling statement due to statement timeout' },
    updates: [],
  }

  await assertRejects(() => provisionIfNeeded(fakeAdminClient(opts) as never, 'req-1'))

  assertEquals(opts.updates.length, 0)
})

// Same rule one step earlier. This lookup used to be treated as "no work to
// do": a transient failure reading the request meant the webhook returned 200
// and the purchase was lost silently.
Deno.test('throws when the request lookup fails, so the Stripe webhook returns non-2xx and Stripe redelivers', async () => {
  const opts: FakeOpts = {
    requestRow: null,
    requestError: { code: '57014', message: 'canceling statement due to statement timeout' },
    provisionRow: null,
    updates: [],
  }

  await assertRejects(() => provisionIfNeeded(fakeAdminClient(opts) as never, 'req-1'))

  // Nothing was written: no provision was even read, let alone marked failed.
  assertEquals(opts.updates.length, 0)
})

Deno.test('marks the provision failed instead of throwing when the connector is retired', async () => {
  const opts: FakeOpts = {
    requestRow: { automations: { requires_provisioning: true, connector_type: 'twilio_missed_call' } },
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

// The retired-connector write is guarded on 'pending' ONLY, never on
// ['pending','provisioning']: concierge-setup:112 parks every live concierge at
// 'provisioning', so the broader guard would flip a working, paid, serving
// concierge to 'failed' on a redelivered Stripe event.
Deno.test('the retired-connector failure write does not reach a row already at provisioning', async () => {
  const opts: FakeOpts = {
    requestRow: { automations: { requires_provisioning: true, connector_type: 'twilio_missed_call' } },
    provisionRow: {
      id: 'prov-live',
      connector_type: 'twilio_missed_call',
      business_name: 'Acme Coaching',
      // Where a live, set-up concierge sits.
      status: 'provisioning',
    },
    updates: [],
  }

  await provisionIfNeeded(fakeAdminClient(opts) as never, 'req-1')

  assertEquals(opts.updates.length, 1)
  assertEquals((opts.updates[0].patch as { status: string }).status, 'failed')
  // 'pending', not 'pending|provisioning'. The fake records an `.in()` guard as
  // the joined list, so this equality is what fails if the guard ever widens.
  assertEquals(opts.updates[0].matchedStatus, 'pending')
})

Deno.test('marks the provision failed instead of throwing when connector_type is null (legacy row)', async () => {
  const opts: FakeOpts = {
    // Neither side names a connector: the automation's null falls through to
    // the provision's null, and getConnector refuses both.
    requestRow: { automations: { requires_provisioning: true, connector_type: null } },
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
    requestRow: { automations: { requires_provisioning: true, connector_type: 'booking_concierge' } },
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

// The highest-value case in this file. automation_provisions.connector_type
// carried a DB default of the now-retired 'twilio_missed_call' until
// 20260807160000 dropped it, so a Sheets/concierge purchase can be born
// mislabeled. Dispatching on that column charges a Booking Concierge customer
// and then marks their provision permanently 'failed'.
Deno.test("the automation's connector_type wins over a mislabeled provision column", async () => {
  const opts: FakeOpts = {
    requestRow: { automations: { requires_provisioning: true, connector_type: 'booking_concierge' } },
    provisionRow: {
      id: 'prov-mislabeled',
      // The stale DB default. The truth is the automation above.
      connector_type: 'twilio_missed_call',
      business_name: 'Acme Coaching',
      status: 'pending',
    },
    updates: [],
    claimSucceeds: true,
  }

  await provisionIfNeeded(fakeAdminClient(opts) as never, 'req-1')

  // Provisioned normally: claim from 'pending', then persist 'active'. Nothing
  // was marked 'failed' — the retired type on the provision row is ignored.
  assertEquals(opts.updates.length, 2)
  assertEquals((opts.updates[0].patch as { status: string }).status, 'provisioning')
  assertEquals(opts.updates[0].matchedStatus, 'pending')
  assertEquals((opts.updates[1].patch as { status: string }).status, 'active')
  assertEquals(opts.updates.some((u) => (u.patch as { status?: string }).status === 'failed'), false)
})

Deno.test('does not re-run fulfillment when another delivery already claimed the row', async () => {
  const opts: FakeOpts = {
    requestRow: { automations: { requires_provisioning: true, connector_type: 'booking_concierge' } },
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
