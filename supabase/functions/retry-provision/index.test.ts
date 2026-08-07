import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { handleRetryProvision } from './index.ts'

interface FakeUserClientOpts {
  provisionRow: { id: string; connector_type?: string; business_name: string; status: string } | null
  claimSucceeds: boolean
  updates: { patch: unknown; matchedStatus?: string }[]
}

function fakeUserClient(opts: FakeUserClientOpts) {
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
  })
  assertEquals(res.status, 400)
})

Deno.test('returns 404 when no failed provision exists for the request (also the RLS non-admin path)', async () => {
  const res = await handleRetryProvision(reqWithAuth({ requestId: 'req-1' }), {
    createUserClient: () => fakeUserClient({ provisionRow: null, claimSucceeds: false, updates: [] }) as never,
  })
  assertEquals(res.status, 404)
})

Deno.test('retries a failed provision through its connector and returns the new status', async () => {
  const opts: FakeUserClientOpts = {
    provisionRow: {
      id: 'prov-1',
      connector_type: 'booking_concierge',
      business_name: 'Acme Coaching',
      status: 'failed',
    },
    claimSucceeds: true,
    updates: [],
  }
  const res = await handleRetryProvision(reqWithAuth({ requestId: 'req-1' }), {
    createUserClient: () => fakeUserClient(opts) as never,
  })

  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.status, 'active')
})

// Replaces 'returns 200 with status failed when the retry purchase fails again',
// which drove the deleted Twilio purchase. The retryable failure it covered no
// longer exists; the unretryable one below took its place.
Deno.test('returns 409, not 500, when the provision belongs to a retired connector', async () => {
  const opts: FakeUserClientOpts = {
    provisionRow: {
      id: 'prov-1',
      connector_type: 'twilio_missed_call',
      business_name: 'Acme Plumbing',
      status: 'failed',
    },
    claimSucceeds: true,
    updates: [],
  }
  const res = await handleRetryProvision(reqWithAuth({ requestId: 'req-1' }), {
    createUserClient: () => fakeUserClient(opts) as never,
  })

  // The admin pressing Retry must learn the row is unretryable, not see an
  // opaque server error.
  assertEquals(res.status, 409)
  const body = await res.json()
  assertStringIncludes(body.error, 'retired')
})
