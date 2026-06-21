import { describe, it, expect, vi } from 'vitest'
import { listPublicConnectors } from './ConnectorService'

const liveRow = {
  connector_type: 'google_sheets', display_name: 'Google Sheets', category: 'Tabellen & Leads',
  status: 'live', is_public: true, sort_order: 10, created_at: '2026-06-21T00:00:00Z',
}
const soonRow = {
  connector_type: 'hubspot', display_name: 'HubSpot', category: 'CRM',
  status: 'coming_soon', is_public: true, sort_order: 20, created_at: '2026-06-21T00:00:00Z',
}

let capturedFilter: { col: string; val: unknown } | null = null

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
  },
}))

describe('ConnectorService', () => {
  it('lists public connectors filtered to is_public', async () => {
    const result = await listPublicConnectors()
    expect(result).toHaveLength(2)
    expect(result[0].connector_type).toBe('google_sheets')
    expect(capturedFilter).toEqual({ col: 'is_public', val: true })
  })
})
