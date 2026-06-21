import { describe, it, expect, vi } from 'vitest'
import { submitMarketplaceCapture } from './MarketplaceCaptureService'

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    functions: { invoke: vi.fn(() => Promise.resolve({ data: { ok: true }, error: null })) },
  },
}))

describe('submitMarketplaceCapture', () => {
  it('invokes the marketplace-test-capture function with the given payload', async () => {
    const { supabase } = await import('../lib/supabaseClient')

    await submitMarketplaceCapture({ email: 'a@b.com', businessName: 'Acme Plumbing', automationOfInterest: 'Missed-Call Recovery' })

    expect(supabase.functions.invoke).toHaveBeenCalledWith('marketplace-test-capture', {
      body: { email: 'a@b.com', business_name: 'Acme Plumbing', automation_of_interest: 'Missed-Call Recovery' },
    })
  })

  it('throws when the function returns an error', async () => {
    const { supabase } = await import('../lib/supabaseClient')
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error: new Error('boom') } as never)

    await expect(submitMarketplaceCapture({ email: 'a@b.com', businessName: 'Acme' })).rejects.toThrow('boom')
  })
})
