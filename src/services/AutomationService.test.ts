import { describe, it, expect, vi } from 'vitest'
import { listActiveAutomations, getAutomationById } from './AutomationService'

vi.mock('../lib/supabaseClient', () => {
  const sample = {
    id: 'auto-1', name: 'Invoice Sync', summary: 'Syncs invoices', outcome_description: 'Saves 5 hours/week',
    category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, created_at: '2026-06-01T00:00:00Z',
  }
  const chain = {
    order: () => Promise.resolve({ data: [sample], error: null }),
    single: () => Promise.resolve({ data: sample, error: null }),
  }
  return { supabase: { from: () => ({ select: () => ({ eq: () => chain }) }) } }
})

describe('AutomationService', () => {
  it('lists active automations', async () => {
    const result = await listActiveAutomations()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Invoice Sync')
  })

  it('returns a single automation by id', async () => {
    const result = await getAutomationById('auto-1')
    expect(result?.category).toBe('finance')
  })
})
