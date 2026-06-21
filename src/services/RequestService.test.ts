import { describe, it, expect, vi } from 'vitest'
import { createRequest, createCheckoutSession, createProvisionDetails, listMyRequests, listAllRequests, updateRequestStatus, retryProvisioning } from './RequestService'

vi.mock('../lib/supabaseClient', () => {
  const sampleRequest = {
    id: 'req-1', automation_id: 'auto-1', customer_id: 'user-1', status: 'requested',
    stripe_checkout_session_id: null, delivery_notes: null, requested_at: '2026-06-18T00:00:00Z', paid_at: null, delivered_at: null,
  }
  const sampleRequestWithAutomation = {
    ...sampleRequest,
    automation: { id: 'auto-1', name: 'Invoice Sync', summary: 'x', outcome_description: 'y', category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, requires_provisioning: false, created_at: '2026-06-01T00:00:00Z' },
    automation_provisions: [],
  }

  function chainableList(data: unknown[]) {
    const promise = Promise.resolve({ data, error: null }) as Promise<{ data: unknown[]; error: null }> & {
      eq: (col: string, val: unknown) => Promise<{ data: unknown[]; error: null }>
    }
    promise.eq = () => Promise.resolve({ data, error: null })
    return promise
  }

  const capturedSelects: string[] = []

  return {
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
      from: (table: string) => {
        if (table === 'automation_provisions') {
          return { insert: (row: unknown) => Promise.resolve({ data: row, error: null }) }
        }
        return {
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: sampleRequest, error: null }) }) }),
          select: (query: string) => {
            capturedSelects.push(query)
            return { order: () => chainableList([sampleRequestWithAutomation]) }
          },
          update: () => ({
            eq: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: { ...sampleRequest, status: 'delivered', delivery_notes: 'Done' }, error: null }),
              }),
            }),
          }),
        }
      },
      functions: { invoke: vi.fn(() => Promise.resolve({ data: { url: 'https://checkout.stripe.com/session-1' }, error: null })) },
    },
    __capturedSelects: capturedSelects,
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

  it("lists the current user's requests with their automation and provisions joined", async () => {
    const mod = (await import('../lib/supabaseClient')) as unknown as { __capturedSelects: string[] }
    const result = await listMyRequests()
    expect(result).toHaveLength(1)
    expect(mod.__capturedSelects.some((q) => q.includes('automation_provisions'))).toBe(true)
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

  it('creates a pending provision row with the business details for a request', async () => {
    const { supabase } = await import('../lib/supabaseClient')
    const fromSpy = vi.spyOn(supabase, 'from')
    await createProvisionDetails('req-1', { businessName: 'Acme Plumbing', bookingLink: 'https://cal.com/acme' })
    expect(fromSpy).toHaveBeenCalledWith('automation_provisions')
  })

  it('invokes the retry-provision function with the request id and returns the new status', async () => {
    const { supabase } = await import('../lib/supabaseClient')
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: { status: 'active' }, error: null } as never)
    const result = await retryProvisioning('req-1')
    expect(supabase.functions.invoke).toHaveBeenCalledWith('retry-provision', { body: { requestId: 'req-1' } })
    expect(result.status).toBe('active')
  })
})
