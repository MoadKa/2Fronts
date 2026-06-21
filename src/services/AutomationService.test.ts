import { describe, it, expect, vi } from 'vitest'
import { listActiveAutomations, getAutomationById, listAllAutomations, createAutomation, updateAutomation } from './AutomationService'

const sample = {
  id: 'auto-1', name: 'Invoice Sync', summary: 'Syncs invoices', outcome_description: 'Saves 5 hours/week',
  category: 'finance', price_cents: 49900, currency: 'eur', is_active: true, requires_provisioning: false, created_at: '2026-06-01T00:00:00Z',
}

vi.mock('../lib/supabaseClient', () => {
  const selectChain = {
    eq: () => ({
      order: () => Promise.resolve({ data: [sample], error: null }),
      single: () => Promise.resolve({ data: sample, error: null }),
    }),
    order: () => Promise.resolve({ data: [sample], error: null }),
  }
  const insertChain = { select: () => ({ single: () => Promise.resolve({ data: sample, error: null }) }) }
  const updateChain = {
    eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { ...sample, name: 'Updated' }, error: null }) }) }),
  }
  return {
    supabase: {
      from: () => ({ select: () => selectChain, insert: () => insertChain, update: () => updateChain }),
    },
  }
})

describe('AutomationService', () => {
  it('lists active automations', async () => {
    expect(await listActiveAutomations()).toHaveLength(1)
  })

  it('returns a single automation by id', async () => {
    expect((await getAutomationById('auto-1'))?.category).toBe('finance')
  })

  it('lists all automations including inactive ones, for admins', async () => {
    expect(await listAllAutomations()).toHaveLength(1)
  })

  it('creates a new automation defaulting currency to eur', async () => {
    const result = await createAutomation({
      name: 'Invoice Sync', summary: 'Syncs invoices', outcome_description: 'Saves time', category: 'finance', price_cents: 49900,
    })
    expect(result.id).toBe('auto-1')
  })

  it('updates an existing automation', async () => {
    const result = await updateAutomation('auto-1', { name: 'Updated' })
    expect(result.name).toBe('Updated')
  })
})
