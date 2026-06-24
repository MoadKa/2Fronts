import { assertEquals } from 'jsr:@std/assert@1'
import { handleConciergeSetup } from './index.ts'

// Fake admin client modelling loadOwnedProvision (select config +
// automation_requests(customer_id)) and the config update. Mirrors the
// slack-configure test's shape.
interface Captured {
  provision: { config: Record<string, unknown>; customerId: string | null } | null
  updatePatch: Record<string, unknown> | null
}

function fakeAdminClient(c: Captured) {
  return () => ({
    from(table: string) {
      if (table !== 'automation_provisions') throw new Error(`unexpected table ${table}`)
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: () =>
                  Promise.resolve(
                    c.provision
                      ? {
                          data: {
                            config: c.provision.config,
                            automation_requests: { customer_id: c.provision.customerId },
                          },
                          error: null,
                        }
                      : { data: null, error: null },
                  ),
              }
            },
          }
        },
        update(patch: Record<string, unknown>) {
          c.updatePatch = patch
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
  })
}

function postReq(body: unknown, auth = 'Bearer t') {
  return new Request('http://localhost/concierge-setup', {
    method: 'POST',
    headers: { Authorization: auth },
    body: JSON.stringify(body),
  })
}

const deps = (c: Captured, uid: string | null = 'user-1') => ({
  createAdminClient: fakeAdminClient(c) as never,
  getUserId: () => Promise.resolve(uid),
})

Deno.test('OPTIONS preflight returns CORS headers', async () => {
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
  const res = await handleConciergeSetup(new Request('http://localhost/x', { method: 'OPTIONS' }), deps(c))
  assertEquals(res.status, 200)
  await res.body?.cancel()
})

Deno.test('links the concierge id onto the owning provision config', async () => {
  const c: Captured = { provision: { config: { existing: 1 }, customerId: 'user-1' }, updatePatch: null }
  const res = await handleConciergeSetup(postReq({ provisionId: 'prov-1', conciergeId: 'con-9' }), deps(c))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).ok, true)
  // The concierge id is merged into config without losing existing keys.
  const cfg = c.updatePatch?.config as Record<string, unknown>
  assertEquals(cfg.concierge_id, 'con-9')
  assertEquals(cfg.existing, 1)
})

Deno.test('rejects an unauthenticated caller with 401', async () => {
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
  const res = await handleConciergeSetup(postReq({ provisionId: 'prov-1', conciergeId: 'con-9' }), deps(c, null))
  assertEquals(res.status, 401)
  assertEquals(c.updatePatch, null)
})

Deno.test('rejects a caller who does not own the provision with 403', async () => {
  const c: Captured = { provision: { config: {}, customerId: 'someone-else' }, updatePatch: null }
  const res = await handleConciergeSetup(postReq({ provisionId: 'prov-1', conciergeId: 'con-9' }), deps(c, 'user-1'))
  assertEquals(res.status, 403)
  assertEquals(c.updatePatch, null)
})

Deno.test('returns 404 when the provision does not exist', async () => {
  const c: Captured = { provision: null, updatePatch: null }
  const res = await handleConciergeSetup(postReq({ provisionId: 'nope', conciergeId: 'con-9' }), deps(c))
  assertEquals(res.status, 404)
})

Deno.test('returns 400 when provisionId or conciergeId is missing', async () => {
  const c: Captured = { provision: { config: {}, customerId: 'user-1' }, updatePatch: null }
  const res = await handleConciergeSetup(postReq({ provisionId: 'prov-1' }), deps(c))
  assertEquals(res.status, 400)
  assertEquals(c.updatePatch, null)
})
