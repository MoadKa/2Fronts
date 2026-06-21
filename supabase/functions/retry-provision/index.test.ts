import { assertEquals } from 'jsr:@std/assert@1'
import { handleRetryProvision, type ProvisionAutomation } from './index.ts'

function fakeUserClient(opts: { provisionRow: { id: string; business_name: string; status: string } | null; claimSucceeds: boolean; updates: { patch: unknown; matchedStatus?: string }[] }) {
  return {
    from(table: string) {
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
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

function reqWithAuth(body: unknown, authHeader = 'Bearer fake-jwt'): Request {
  return new Request('http://localhost/retry-provision', {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

Deno.test('returns 400 when requestId is missing from the body', async () => {
  const res = await handleRetryProvision(reqWithAuth({}), {
    createUserClient: () => fakeUserClient({ provisionRow: null, claimSucceeds: false, updates: [] }) as never,
    provisionAutomation: { purchaseNumber: () => Promise.resolve({ phoneNumber: '+31612345678', sid: 'PN1' }) } as ProvisionAutomation,
  })
  assertEquals(res.status, 400)
})

Deno.test('returns 404 when no failed provision exists for the request (also the RLS non-admin path)', async () => {
  const res = await handleRetryProvision(reqWithAuth({ requestId: 'req-1' }), {
    createUserClient: () => fakeUserClient({ provisionRow: null, claimSucceeds: false, updates: [] }) as never,
    provisionAutomation: { purchaseNumber: () => Promise.resolve({ phoneNumber: '+31612345678', sid: 'PN1' }) } as ProvisionAutomation,
  })
  assertEquals(res.status, 404)
})

Deno.test('retries a failed provision and returns the new status on success', async () => {
  const opts = { provisionRow: { id: 'prov-1', business_name: 'Acme Plumbing', status: 'failed' }, claimSucceeds: true, updates: [] }
  const res = await handleRetryProvision(reqWithAuth({ requestId: 'req-1' }), {
    createUserClient: () => fakeUserClient(opts) as never,
    provisionAutomation: { purchaseNumber: () => Promise.resolve({ phoneNumber: '+31612345678', sid: 'PN1' }) } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.status, 'active')
  assertEquals(opts.updates[0].matchedStatus, 'failed')
})

Deno.test('returns 200 with status failed when the retry purchase fails again', async () => {
  const opts = { provisionRow: { id: 'prov-1', business_name: 'Acme Plumbing', status: 'failed' }, claimSucceeds: true, updates: [] }
  const res = await handleRetryProvision(reqWithAuth({ requestId: 'req-1' }), {
    createUserClient: () => fakeUserClient(opts) as never,
    provisionAutomation: { purchaseNumber: () => Promise.reject(new Error('still suspended')) } as ProvisionAutomation,
  })

  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.status, 'failed')
})
