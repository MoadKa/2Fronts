import { assertEquals } from 'jsr:@std/assert@1'
import { handleIntake } from './index.ts'

interface CapturedInsert {
  table?: string
  patch?: unknown
  updatePatch?: Record<string, unknown>
}

// Fake admin client modeled on fakeAdminClient in stripe-webhook/index.test.ts:
// records .from(table).insert(patch) and resolves the inserted row's id. Also
// records .update(patch).eq(...) so the lead-status write can be asserted.
function fakeAdminClient(captured: CapturedInsert, opts: { insertError?: unknown; id?: string } = {}) {
  const { insertError = null, id = 'lead-123' } = opts
  return () => ({
    from(table: string) {
      captured.table = table
      return {
        insert(patch: unknown) {
          captured.patch = patch
          return {
            select() {
              return {
                single: () =>
                  Promise.resolve(
                    insertError
                      ? { data: null, error: insertError }
                      : { data: { id }, error: null },
                  ),
              }
            },
          }
        },
        update(patch: Record<string, unknown>) {
          captured.updatePatch = patch
          return { eq(_c: string, _v: string) { return Promise.resolve({ error: null }) } }
        },
      }
    },
  })
}

function postReq(body: string) {
  return new Request('http://localhost/intake', { method: 'POST', body })
}

Deno.test('inserts into leads with status received and returns 200 for a valid body', async () => {
  const captured: CapturedInsert = {}
  const req = postReq(
    JSON.stringify({
      customer_id: 'cust-1',
      automation_id: 'auto-1',
      source: 'webform',
      payload: { name: 'Jane', phone: '+49123' },
    }),
  )

  const res = await handleIntake(req, { createAdminClient: fakeAdminClient(captured) as never })

  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.received, true)
  assertEquals(json.id, 'lead-123')

  assertEquals(captured.table, 'leads')
  const patch = captured.patch as Record<string, unknown>
  assertEquals(patch.customer_id, 'cust-1')
  assertEquals(patch.automation_id, 'auto-1')
  assertEquals(patch.source, 'webform')
  assertEquals(patch.status, 'received')
  assertEquals(patch.payload, { name: 'Jane', phone: '+49123' })
})

Deno.test('defaults source to api and automation_id to null when omitted', async () => {
  const captured: CapturedInsert = {}
  const req = postReq(JSON.stringify({ customer_id: 'cust-1', payload: { x: 1 } }))

  const res = await handleIntake(req, { createAdminClient: fakeAdminClient(captured) as never })

  assertEquals(res.status, 200)
  const patch = captured.patch as Record<string, unknown>
  assertEquals(patch.source, 'api')
  assertEquals(patch.automation_id, null)
})

Deno.test('returns 400 and does not touch the DB when customer_id is missing', async () => {
  const captured: CapturedInsert = {}
  const req = postReq(JSON.stringify({ payload: { x: 1 } }))

  const res = await handleIntake(req, { createAdminClient: fakeAdminClient(captured) as never })

  assertEquals(res.status, 400)
  assertEquals(captured.table, undefined)
})

Deno.test('returns 400 when payload is missing', async () => {
  const captured: CapturedInsert = {}
  const req = postReq(JSON.stringify({ customer_id: 'cust-1' }))

  const res = await handleIntake(req, { createAdminClient: fakeAdminClient(captured) as never })

  assertEquals(res.status, 400)
  assertEquals(captured.table, undefined)
})

Deno.test('returns 400 when payload is an empty object', async () => {
  const captured: CapturedInsert = {}
  const req = postReq(JSON.stringify({ customer_id: 'cust-1', payload: {} }))

  const res = await handleIntake(req, { createAdminClient: fakeAdminClient(captured) as never })

  assertEquals(res.status, 400)
  assertEquals(captured.table, undefined)
})

Deno.test('returns 400 when the body is not valid JSON', async () => {
  const captured: CapturedInsert = {}
  const req = postReq('not json{')

  const res = await handleIntake(req, { createAdminClient: fakeAdminClient(captured) as never })

  assertEquals(res.status, 400)
  assertEquals(captured.table, undefined)
})

Deno.test('OPTIONS preflight returns the CORS headers without touching the DB', async () => {
  const captured: CapturedInsert = {}
  const req = new Request('http://localhost/intake', { method: 'OPTIONS' })

  const res = await handleIntake(req, { createAdminClient: fakeAdminClient(captured) as never })

  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS')
  assertEquals(captured.table, undefined)
  await res.body?.cancel()
})

Deno.test('files the lead on intake: status -> filed, filed:true', async () => {
  const captured: CapturedInsert = {}
  const req = postReq(JSON.stringify({ customer_id: 'cust-1', payload: { Name: 'Jane' } }))

  const res = await handleIntake(req, {
    createAdminClient: fakeAdminClient(captured) as never,
    fileLead: () => Promise.resolve({ outcome: 'filed' }),
    leadFilingDeps: { getAccessToken: () => Promise.resolve('t') },
  })

  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.filed, true)
  assertEquals(captured.updatePatch?.status, 'filed')
  assertEquals(typeof captured.updatePatch?.filed_at, 'string')
})

Deno.test('needs_review outcome: status -> needs_review, filed:false, no filed_at', async () => {
  const captured: CapturedInsert = {}
  const req = postReq(JSON.stringify({ customer_id: 'cust-1', payload: { Name: 'Jane' } }))

  const res = await handleIntake(req, {
    createAdminClient: fakeAdminClient(captured) as never,
    fileLead: () => Promise.resolve({ outcome: 'needs_review', reason: 'missing phone' }),
    leadFilingDeps: { getAccessToken: () => Promise.resolve('t') },
  })

  assertEquals(res.status, 200)
  assertEquals((await res.json()).filed, false)
  assertEquals(captured.updatePatch?.status, 'needs_review')
  assertEquals(captured.updatePatch?.filed_at, null)
})

Deno.test('a thrown filing error never breaks intake: lead recorded, still 200', async () => {
  const captured: CapturedInsert = {}
  const req = postReq(JSON.stringify({ customer_id: 'cust-1', payload: { Name: 'Jane' } }))

  const res = await handleIntake(req, {
    createAdminClient: fakeAdminClient(captured) as never,
    fileLead: () => Promise.reject(new Error('sheets exploded')),
    leadFilingDeps: { getAccessToken: () => Promise.resolve('t') },
  })

  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.received, true)
  assertEquals(json.filed, false)
  // The lead row was still inserted; intake stayed healthy.
  assertEquals(captured.patch !== undefined, true)
})

Deno.test('skipped outcome (no mapping yet) leaves the lead at received', async () => {
  const captured: CapturedInsert = {}
  const req = postReq(JSON.stringify({ customer_id: 'cust-1', payload: { Name: 'Jane' } }))

  const res = await handleIntake(req, {
    createAdminClient: fakeAdminClient(captured) as never,
    fileLead: () => Promise.resolve({ outcome: 'skipped' }),
    leadFilingDeps: { getAccessToken: () => Promise.resolve('t') },
  })

  assertEquals(res.status, 200)
  assertEquals((await res.json()).filed, false)
  // No status update for 'skipped' — the lead waits at 'received'.
  assertEquals(captured.updatePatch, undefined)
})

Deno.test('returns 500 when the admin insert returns an error', async () => {
  const captured: CapturedInsert = {}
  const req = postReq(JSON.stringify({ customer_id: 'cust-1', payload: { x: 1 } }))

  const res = await handleIntake(req, {
    createAdminClient: fakeAdminClient(captured, { insertError: new Error('db down') }) as never,
  })

  assertEquals(res.status, 500)
  assertEquals(captured.table, 'leads')
  await res.body?.cancel()
})
