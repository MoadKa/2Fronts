import { assertEquals } from 'jsr:@std/assert@1'
import { type ConfirmDeps, handleConfirmMapping } from './index.ts'

interface Captured {
  config?: Record<string, unknown>
  status?: string
}

function fakeAdminClient(captured: Captured, opts: { customerId?: string } = {}) {
  return () => ({
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_c: string, _v: string) {
              return {
                maybeSingle() {
                  return Promise.resolve({
                    data: {
                      config: { proposedMapping: { keep: true } },
                      automation_requests: { customer_id: opts.customerId ?? 'cust-1' },
                    },
                    error: null,
                  })
                },
              }
            },
          }
        },
        update(payload: { config: Record<string, unknown>; status: string }) {
          captured.config = payload.config
          captured.status = payload.status
          return { eq(_c: string, _v: string) { return Promise.resolve({ error: null }) } }
        },
      }
    },
  })
}

function makeDeps(captured: Captured, overrides: Partial<ConfirmDeps> = {}): ConfirmDeps {
  return {
    createAdminClient: fakeAdminClient(captured) as never,
    getUserId: () => Promise.resolve('cust-1'),
    ...overrides,
  }
}

function postReq(bodyObj: unknown) {
  return new Request('http://localhost/confirm-mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake' },
    body: JSON.stringify(bodyObj),
  })
}

const MAPPING = [
  { field: 'Name', column: 'Name' },
  { field: 'Telefon', column: 'Telefon' },
]

Deno.test('writes columnMapping + status for the provision owner, preserving existing config', async () => {
  const captured: Captured = {}
  const res = await handleConfirmMapping(postReq({ provisionId: 'prov-1', columnMapping: MAPPING }), makeDeps(captured))

  assertEquals(res.status, 200)
  assertEquals((await res.json()).ok, true)
  // The exact key run() reads, and the proposal is preserved (not overwritten).
  assertEquals(captured.config?.columnMapping, MAPPING)
  assertEquals((captured.config?.proposedMapping as { keep: boolean }).keep, true)
  assertEquals(captured.status, 'provisioning')
})

Deno.test('rejects a non-owner (403, no write)', async () => {
  const captured: Captured = {}
  const res = await handleConfirmMapping(
    postReq({ provisionId: 'prov-1', columnMapping: MAPPING }),
    makeDeps(captured, { getUserId: () => Promise.resolve('someone-else') }),
  )
  assertEquals(res.status, 403)
  assertEquals(captured.config, undefined)
})

Deno.test('rejects an unauthenticated caller (401)', async () => {
  const captured: Captured = {}
  const res = await handleConfirmMapping(
    postReq({ provisionId: 'prov-1', columnMapping: MAPPING }),
    makeDeps(captured, { getUserId: () => Promise.resolve(null) }),
  )
  assertEquals(res.status, 401)
  assertEquals(captured.config, undefined)
})

Deno.test('rejects a malformed mapping (400, no write)', async () => {
  const captured: Captured = {}
  const res = await handleConfirmMapping(
    postReq({ provisionId: 'prov-1', columnMapping: [{ field: 'Name' }, 'nope'] }),
    makeDeps(captured),
  )
  assertEquals(res.status, 400)
  assertEquals(captured.config, undefined)
})
