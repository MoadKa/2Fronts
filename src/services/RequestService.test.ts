import { describe, it, expect, vi } from 'vitest'
import { createRequest, createCheckoutSession, listMyRequests } from './RequestService'

const sampleRequest = {
  id: 'req-1', automation_id: 'auto-1', customer_id: 'user-1', status: 'requested',
  stripe_checkout_session_id: null, delivery_notes: null, requested_at: '2026-06-18T00:00:00Z', paid_at: null, delivered_at: null,
}

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } })) },
    from: vi.fn(() => ({
      insert: vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: sampleRequest, error: null }) }) })),
      select: vi.fn(() => ({ order: () => Promise.resolve({ data: [sampleRequest], error: null }) })),
    })),
    functions: { invoke: vi.fn(() => Promise.resolve({ data: { url: 'https://checkout.stripe.com/session-1' }, error: null })) },
  },
}))

describe('RequestService', () => {
  it('creates a request tied to the signed-in user', async () => {
    const result = await createRequest('auto-1')
    expect(result.id).toBe('req-1')
  })

  it('throws when no user is signed in', async () => {
    const { supabase } = await import('../lib/supabaseClient')
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({ data: { user: null } } as never)
    await expect(createRequest('auto-1')).rejects.toThrow('Must be signed in to request an automation')
  })

  it('invokes the create-checkout-session function and returns its url', async () => {
    const result = await createCheckoutSession('req-1')
    expect(result.url).toBe('https://checkout.stripe.com/session-1')
  })

  it("lists the current user's requests with their automation joined", async () => {
    const result = await listMyRequests()
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('requested')
  })
})
