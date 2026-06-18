import { describe, it, expect, vi } from 'vitest'
import { createRequest, createCheckoutSession, listMyRequests, listAllRequests, updateRequestStatus } from './RequestService'

vi.mock('../lib/supabaseClient', () => {
  const sampleRequest = {
    id: 'req-1', automation_id: 'auto-1', customer_id: 'user-1', status: 'requested',
    stripe_checkout_session_id: null, delivery_notes: null, requested_at: '2026-06-18T00:00:00Z', paid_at: null, delivered_at: null,
  }
  const sampleRequestWithAutomation = {
    ...sampleRequest,
    automation: { id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'y', category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z' },
  }

  function chainableList(data: unknown[]) {
    const promise = Promise.resolve({ data, error: null }) as Promise<{ data: unknown[]; error: null }> & {
      eq: (col: string, val: unknown) => Promise<{ data: unknown[]; error: null }>
    }
    promise.eq = () => Promise.resolve({ data, error: null })
    return promise
  }

  return {
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
      from: () => ({
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: sampleRequest, error: null }) }) }),
        select: () => ({ order: () => chainableList([sampleRequestWithAutomation]) }),
        update: () => ({
          eq: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { ...sampleRequest, status: 'delivered', delivery_notes: 'Done' }, error: null }),
            }),
          }),
        }),
      }),
      functions: { invoke: () => Promise.resolve({ data: { url: 'https://checkout.stripe.com/session-1' }, error: null }) },
    },
  }
})

describe('RequestService', () => {
  it('creates a request tied to the signed-in user', async () => {
    const result = await createRequest('auto-1')
    expect(result.id).toBe('req-1')
  })

  it('throws when no user is signed in', async () => {
    const { supabase } = await import('../lib/supabaseClient')
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValueOnce({ data: { user: null } } as never)
    await expect(createRequest('auto-1')).rejects.toThrow('Must be signed in to request an automation')
  })

  it('invokes the create-checkout-session function and returns its url', async () => {
    const result = await createCheckoutSession('req-1')
    expect(result.url).toBe('https://checkout.stripe.com/session-1')
  })

  it("lists the current user's requests with their automation joined", async () => {
    const result = await listMyRequests()
    expect(result).toHaveLength(1)
  })

  it('lists all requests with their automation joined', async () => {
    const result = await listAllRequests()
    expect(result[0].automation.name).toBe('Invoice Sync')
  })

  it('filters requests by status when provided', async () => {
    const result = await listAllRequests({ status: 'paid' })
    expect(result).toHaveLength(1)
  })

  it('updates a request status and records delivery notes', async () => {
    const result = await updateRequestStatus('req-1', 'delivered', 'Done')
    expect(result.status).toBe('delivered')
    expect(result.delivery_notes).toBe('Done')
  })
})
