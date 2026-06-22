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

let invokePayload: { name: string; body: unknown } | null = null
let invokeResult: { data: unknown; error: unknown } = { data: { ok: true }, error: null }

vi.mock('../lib/supabaseClient', () => {
  const selectChain = {
    eq: () => ({ single: () => Promise.resolve({ data: provisionRow, error: null }) }),
  }
  return {
    supabase: {
      from: () => ({ select: () => selectChain }),
      functions: {
        invoke: (name: string, opts: { body: unknown }) => {
          invokePayload = { name, body: opts.body }
          return Promise.resolve(invokeResult)
        },
      },
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

  it('saves the confirmed mapping via the confirm-mapping edge function (server-side write)', async () => {
    invokePayload = null
    invokeResult = { data: { ok: true }, error: null }
    await saveConfirmedMapping('prov-1', [
      { field: 'name', column: 'B' },
      { field: 'source', column: 'C' },
    ])
    // Must go through the server (RLS blocks a client-side UPDATE), with the
    // mapping under `columnMapping` — the exact key the connector's run() reads.
    // TS narrows the closure-assigned let to `null` here; cast through unknown.
    const sent = invokePayload as unknown as { name: string; body: unknown }
    expect(sent.name).toBe('confirm-mapping')
    expect(sent.body).toEqual({
      provisionId: 'prov-1',
      columnMapping: [
        { field: 'name', column: 'B' },
        { field: 'source', column: 'C' },
      ],
    })
  })

  it('throws when the confirm-mapping function returns an error', async () => {
    invokeResult = { data: null, error: new Error('forbidden') }
    await expect(
      saveConfirmedMapping('prov-1', [{ field: 'name', column: 'B' }]),
    ).rejects.toThrow()
  })
})
