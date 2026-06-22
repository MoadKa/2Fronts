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
    // The vi.mock closure reassigns updatePayload at runtime, but TS's
    // control-flow can't see a closure mutation across the awaited call and
    // narrows it to `null` here — cast through `unknown` to read it back.
    const payload = updatePayload as unknown as {
      status: string
      config: { columnMapping: unknown[]; proposedMapping: unknown }
    }
    expect(payload.status).toBe('provisioning')
    const config = payload.config
    // MUST be `columnMapping` — the exact key the Sheets connector's run() reads.
    expect(config.columnMapping).toHaveLength(2)
    // existing config (the proposed mapping) is preserved, not overwritten.
    expect(config.proposedMapping).toBeDefined()
  })
})
