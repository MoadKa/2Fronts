import { assertEquals } from 'jsr:@std/assert@1'
import type { Connector, ProvisionRow } from './connectors.ts'
import { runConnectorProvision } from './provisioning.ts'

// runConnectorProvision is the claim -> dispatch -> guarded persist core every
// connector inherits. It is tested directly rather than through
// provisionIfNeeded because its two failure branches (claimError, persistError)
// and its concurrent-cancellation guard (!persisted) are DB-error states the
// fulfillment path cannot express, and because its other caller
// (retry-provision) enters with a different fromStatus.

// A PostgREST error as supabase-js surfaces it.
interface FakePostgrestError {
  code?: string
  message: string
}

// What one guarded `UPDATE ... RETURNING` answers: the matched row, or null for
// zero rows (someone else holds/moved it), or an error.
interface Step {
  data: Record<string, unknown> | null
  error: FakePostgrestError | null
}

interface FakeOpts {
  // Answer for the claim UPDATE (the first write).
  claim: Step
  // Answer for the outcome UPDATE (the second write). Defaults to "matched".
  persist?: Step
  updates: { patch: Record<string, unknown>; eqs: [string, unknown][] }[]
}

function fakeClient(opts: FakeOpts) {
  return {
    from(table: string) {
      if (table !== 'automation_provisions') throw new Error(`unexpected table: ${table}`)
      return {
        update(patch: Record<string, unknown>) {
          const record: { patch: Record<string, unknown>; eqs: [string, unknown][] } = { patch, eqs: [] }
          opts.updates.push(record)
          // First write is the claim, second is the persist.
          const step = opts.updates.length === 1
            ? opts.claim
            : (opts.persist ?? { data: { id: 'prov-1' }, error: null })
          const builder = {
            eq(col: string, val: unknown) {
              record.eqs.push([col, val])
              return builder
            },
            select: () => ({ maybeSingle: () => Promise.resolve(step) }),
          }
          return builder
        },
      }
    },
  }
}

// A connector that records whether it ran, so "the guard stopped before
// dispatch" is observable (every real connector's provision() is a no-op today,
// so there is no side effect to spy on otherwise).
function fakeConnector(result: 'active' | 'failed' = 'active') {
  const calls: { fromStatus: string }[] = []
  const connector: Connector = {
    connectorType: 'fake_connector',
    provision: ({ fromStatus }) => {
      calls.push({ fromStatus })
      return Promise.resolve(result)
    },
  }
  return { connector, calls }
}

const row: ProvisionRow = { id: 'prov-1', connector_type: 'fake_connector', status: 'pending' }

Deno.test('claims from the given status, dispatches, and persists active guarded on provisioning', async () => {
  const opts: FakeOpts = { claim: { data: { id: 'prov-1' }, error: null }, updates: [] }
  const { connector, calls } = fakeConnector('active')

  const result = await runConnectorProvision(fakeClient(opts) as never, connector, row, 'pending')

  assertEquals(result, 'active')
  assertEquals(calls.length, 1)
  assertEquals(opts.updates.length, 2)
  assertEquals(opts.updates[0].patch.status, 'provisioning')
  assertEquals(opts.updates[0].eqs[0], ['status', 'pending'])
  assertEquals(opts.updates[1].patch.status, 'active')
  // The outcome write is guarded on 'provisioning', not just the id.
  assertEquals(opts.updates[1].eqs.some(([col, val]) => col === 'status' && val === 'provisioning'), true)
})

// A transient DB error and "somebody else holds the claim" both surface as a
// null row. Conflating them would leave a PAID provision stuck at its old
// status with nobody alerted; 'failed' is what makes the caller notice.
Deno.test('a claim error returns failed and never dispatches the connector', async () => {
  const opts: FakeOpts = {
    claim: { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } },
    updates: [],
  }
  const { connector, calls } = fakeConnector('active')

  const result = await runConnectorProvision(fakeClient(opts) as never, connector, row, 'pending')

  assertEquals(result, 'failed')
  assertEquals(calls.length, 0) // no fulfillment on a claim we never held
  assertEquals(opts.updates.length, 1) // the claim attempt only, no outcome write
})

// The claim is the idempotency boundary: a redelivered Stripe event or a second
// admin hitting Retry matches zero rows and must stop silently, without a
// second dispatch and without an outcome write.
Deno.test('a claim that matches no row returns not-claimed and never dispatches', async () => {
  const opts: FakeOpts = { claim: { data: null, error: null }, updates: [] }
  const { connector, calls } = fakeConnector('active')

  const result = await runConnectorProvision(fakeClient(opts) as never, connector, row, 'pending')

  assertEquals(result, 'not-claimed')
  assertEquals(calls.length, 0)
  assertEquals(opts.updates.length, 1)
})

// Connectors RETURN their result; nothing else writes it. If the persist write
// fails, reporting the connector's 'active' would claim a fulfillment that is
// not in the database — the row stays at 'provisioning' forever.
Deno.test('a persist error returns failed rather than the connector result', async () => {
  const opts: FakeOpts = {
    claim: { data: { id: 'prov-1' }, error: null },
    persist: { data: null, error: { code: '08006', message: 'connection failure' } },
    updates: [],
  }
  const { connector } = fakeConnector('active')

  const result = await runConnectorProvision(fakeClient(opts) as never, connector, row, 'pending')

  assertEquals(result, 'failed')
  assertEquals(opts.updates.length, 2)
})

// The concurrent-cancellation guard. A customer.subscription.deleted arriving
// mid-provision sets the row 'cancelled'; an unguarded outcome write would
// resurrect it as 'active' while its concierge is switched off. Zero matched
// rows means their write won — say so, do not report success.
Deno.test('an outcome write that matches no row does not resurrect it and reports not-claimed', async () => {
  const opts: FakeOpts = {
    claim: { data: { id: 'prov-1' }, error: null },
    // Someone moved the row out of 'provisioning' while the connector ran.
    persist: { data: null, error: null },
    updates: [],
  }
  const { connector, calls } = fakeConnector('active')

  const result = await runConnectorProvision(fakeClient(opts) as never, connector, row, 'pending')

  // NOT 'active': the row someone else moved keeps their status.
  assertEquals(result, 'not-claimed')
  assertEquals(calls.length, 1) // the connector did run; only the write lost
  assertEquals(opts.updates.length, 2)
  // No third, unguarded write retrying the overwrite.
  assertEquals(opts.updates[1].eqs.some(([col, val]) => col === 'status' && val === 'provisioning'), true)
})
