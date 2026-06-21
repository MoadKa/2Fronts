import { assertEquals } from 'jsr:@std/assert@1'
import { attemptProvision, type ProvisionAutomation } from './provisioning.ts'

function fakeAdminClient(opts: {
  claimSucceeds: boolean
  provisionRow: { id: string; business_name: string }
  updates: { patch: unknown; matchedStatus?: string }[]
}) {
  return {
    from() {
      return {
        update(patch: unknown) {
          const record: { patch: unknown; matchedStatus?: string } = { patch }
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
    },
  }
}

Deno.test('claims from the given fromStatus, purchases a number, and marks active on success', async () => {
  const opts = { claimSucceeds: true, provisionRow: { id: 'prov-1', business_name: 'Acme Plumbing' }, updates: [] }
  let purchaseCalledWith = ''

  const result = await attemptProvision(
    fakeAdminClient(opts) as never,
    opts.provisionRow,
    'pending',
    {
      purchaseNumber: (businessName: string) => {
        purchaseCalledWith = businessName
        return Promise.resolve({ phoneNumber: '+31612345678', sid: 'PN123' })
      },
    } as ProvisionAutomation
  )

  assertEquals(result, 'active')
  assertEquals(purchaseCalledWith, 'Acme Plumbing')
  assertEquals(opts.updates[0].matchedStatus, 'pending')
  assertEquals((opts.updates[0].patch as { status: string }).status, 'provisioning')
  assertEquals((opts.updates[1].patch as { status: string; twilio_phone_number: string }).status, 'active')
})

Deno.test('claims from a custom fromStatus (e.g. failed, for retry)', async () => {
  const opts = { claimSucceeds: true, provisionRow: { id: 'prov-1', business_name: 'Acme Plumbing' }, updates: [] }

  await attemptProvision(
    fakeAdminClient(opts) as never,
    opts.provisionRow,
    'failed',
    { purchaseNumber: () => Promise.resolve({ phoneNumber: '+31612345678', sid: 'PN123' }) } as ProvisionAutomation
  )

  assertEquals(opts.updates[0].matchedStatus, 'failed')
})

Deno.test('returns "not-claimed" without purchasing when the claim fails', async () => {
  const opts = { claimSucceeds: false, provisionRow: { id: 'prov-1', business_name: 'Acme Plumbing' }, updates: [] }
  let purchaseWasCalled = false

  const result = await attemptProvision(
    fakeAdminClient(opts) as never,
    opts.provisionRow,
    'pending',
    { purchaseNumber: () => { purchaseWasCalled = true; return Promise.resolve({ phoneNumber: '+31612345678', sid: 'PN123' }) } } as ProvisionAutomation
  )

  assertEquals(result, 'not-claimed')
  assertEquals(purchaseWasCalled, false)
})

Deno.test('returns "failed" and persists the failure when the Twilio purchase throws', async () => {
  const opts = { claimSucceeds: true, provisionRow: { id: 'prov-1', business_name: 'Acme Plumbing' }, updates: [] }

  const result = await attemptProvision(
    fakeAdminClient(opts) as never,
    opts.provisionRow,
    'pending',
    { purchaseNumber: () => Promise.reject(new Error('Twilio account suspended')) } as ProvisionAutomation
  )

  assertEquals(result, 'failed')
  assertEquals((opts.updates[1].patch as { status: string }).status, 'failed')
})
