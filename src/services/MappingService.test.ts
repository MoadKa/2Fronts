import { describe, it, expect, vi } from 'vitest'
import { getProposedMapping, saveConfirmedMapping } from './MappingService'
import type { ProposedMapping } from '../types/database'

const proposedMapping: ProposedMapping = {
  connectorType: 'google_sheets',
  sheetTitle: 'Leads 2026',
  availableColumns: [
    { value: 'A', label: 'Spalte A · „Eingang"' },
    { value: 'B', label: 'Spalte B · „Kundenname"' },
    { value: 'C', label: 'Spalte C · „Quelle"' },
  ],
  sampleLead: { name: 'Anna Weber', phone: '0176 1234567' },
  fields: [
    { field: 'name', label: 'Name', column: 'B', columnLabel: 'Spalte B · „Kundenname"', confidence: 'high' },
    { field: 'source', label: 'Quelle', column: null, columnLabel: null, confidence: 'low' },
  ],
}

const provisionRow = { config: { proposedMapping } }

let updatePayload: Record<string, unknown> | null = null

vi.mock('../lib/supabaseClient', () => {
  const selectChain = {
    eq: () => ({ single: () => Promise.resolve({ data: provisionRow, error: null }) }),
  }
  const updateChain = {
    eq: () => Promise.resolve({ data: null, error: null }),
  }
  return {
    supabase: {
      from: () => ({
        select: () => selectChain,
        update: (payload: Record<string, unknown>) => {
          updatePayload = payload
          return updateChain
        },
      }),
    },
  }
})

describe('MappingService', () => {
  it('fetches the proposed mapping from the provision config', async () => {
    const result = await getProposedMapping('prov-1')
    expect(result?.sheetTitle).toBe('Leads 2026')
    expect(result?.fields).toHaveLength(2)
    expect(result?.fields.find((f) => f.field === 'source')?.confidence).toBe('low')
  })

  it('saves the confirmed mapping and advances the provision to provisioning', async () => {
    updatePayload = null
    await saveConfirmedMapping('prov-1', [
      { field: 'name', column: 'B' },
      { field: 'source', column: 'C' },
    ])
    expect(updatePayload).not.toBeNull()
    expect(updatePayload?.status).toBe('provisioning')
    const config = updatePayload?.config as { confirmedMapping: unknown[]; proposedMapping: unknown }
    expect(config.confirmedMapping).toHaveLength(2)
    // existing config (the proposed mapping) is preserved, not overwritten.
    expect(config.proposedMapping).toBeDefined()
  })
})
