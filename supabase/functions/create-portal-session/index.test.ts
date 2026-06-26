import { assertEquals } from 'jsr:@std/assert@1'
import { handleCreatePortal, type PortalDeps } from './index.ts'

function req(body: unknown, method = 'POST', auth: string | null = 'Bearer jwt') {
  const headers: Record<string, string> = {}
  if (auth) headers.Authorization = auth
  return new Request('http://localhost/create-portal-session', {
    method,
    headers,
    body: method === 'OPTIONS' ? undefined : JSON.stringify(body),
  })
}

function makeDeps(provisionRow: unknown, overrides: Partial<PortalDeps> = {}): PortalDeps {
  return {
    stripe: {
      billingPortal: {
        sessions: { create: () => Promise.resolve({ url: 'https://billing.stripe.test/session' }) },
      },
    } as unknown as PortalDeps['stripe'],
    createUserClient: () =>
      ({
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: provisionRow }) }) }),
        }),
      }) as unknown as ReturnType<PortalDeps['createUserClient']>,
    getEnv: (k: string) => (k === 'PUBLIC_APP_URL' ? 'https://2fronts.de' : undefined),
    ...overrides,
  }
}

Deno.test('owner with a Stripe customer gets a portal URL', async () => {
  const res = await handleCreatePortal(req({ provisionId: 'prov-1' }), makeDeps({ stripe_customer_id: 'cus_1' }))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).url, 'https://billing.stripe.test/session')
})

Deno.test('provision not owned / no customer -> 404 (no leak)', async () => {
  const res = await handleCreatePortal(req({ provisionId: 'prov-x' }), makeDeps(null))
  assertEquals(res.status, 404)
})

Deno.test('a provision without a stripe_customer_id -> 404', async () => {
  const res = await handleCreatePortal(req({ provisionId: 'prov-1' }), makeDeps({ stripe_customer_id: null }))
  assertEquals(res.status, 404)
})

Deno.test('missing Authorization -> 401', async () => {
  const res = await handleCreatePortal(req({ provisionId: 'prov-1' }, 'POST', null), makeDeps({ stripe_customer_id: 'cus_1' }))
  assertEquals(res.status, 401)
})

Deno.test('missing provisionId -> 400', async () => {
  const res = await handleCreatePortal(req({}), makeDeps({ stripe_customer_id: 'cus_1' }))
  assertEquals(res.status, 400)
})

Deno.test('OPTIONS preflight -> 200', async () => {
  const res = await handleCreatePortal(req(undefined, 'OPTIONS'), makeDeps(null))
  assertEquals(res.status, 200)
})
