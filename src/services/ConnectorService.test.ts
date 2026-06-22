import { describe, it, expect, vi } from 'vitest'
import { configureSheet, listPublicConnectors } from './ConnectorService'

const liveRow = {
  connector_type: 'google_sheets', display_name: 'Google Sheets', category: 'Tabellen & Leads',
  status: 'live', is_public: true, sort_order: 10, created_at: '2026-06-21T00:00:00Z',
}
const soonRow = {
  connector_type: 'hubspot', display_name: 'HubSpot', category: 'CRM',
  status: 'coming_soon', is_public: true, sort_order: 20, created_at: '2026-06-21T00:00:00Z',
}

let capturedFilter: { col: string; val: unknown } | null = null
let invokeResult: { data: unknown; error: unknown } = { data: null, error: null }
let capturedInvoke: { name: string; body: unknown } | null = null

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          capturedFilter = { col, val }
          return { order: () => Promise.resolve({ data: [liveRow, soonRow], error: null }) }
        },
      }),
    }),
    functions: {
      invoke: (name: string, opts: { body: unknown }) => {
        capturedInvoke = { name, body: opts.body }
        return Promise.resolve(invokeResult)
      },
    },
  },
}))

describe('ConnectorService', () => {
  it('lists public connectors filtered to is_public', async () => {
    const result = await listPublicConnectors()
    expect(result).toHaveLength(2)
    expect(result[0].connector_type).toBe('google_sheets')
    expect(capturedFilter).toEqual({ col: 'is_public', val: true })
  })

  it('configureSheet invokes connect-configure and returns the proposed mapping', async () => {
    const proposedMapping = { connectorType: 'google_sheets', sheetTitle: 'Leads', fields: [], sampleLead: {}, availableColumns: [] }
    invokeResult = { data: { proposedMapping }, error: null }

    const result = await configureSheet('prov-1', 'https://docs.google.com/spreadsheets/d/abc/edit')

    expect(capturedInvoke?.name).toBe('connect-configure')
    expect(capturedInvoke?.body).toEqual({ provisionId: 'prov-1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit' })
    expect(result.sheetTitle).toBe('Leads')
  })

  it('configureSheet maps a function error to a friendly German message', async () => {
    invokeResult = {
      data: null,
      error: { context: { json: () => Promise.resolve({ error: 'invalid_sheet_url' }) } },
    }

    await expect(configureSheet('prov-1', 'nonsense')).rejects.toThrow(/Google-Sheet aus/)
  })
})
