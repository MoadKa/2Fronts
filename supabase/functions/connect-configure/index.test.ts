import { assertEquals, assertExists } from 'jsr:@std/assert@1'
import { extractSpreadsheetId, handleConfigure, type ConfigureDeps } from './index.ts'
import { type SheetsFetcher } from '../_shared/sheetsClient.ts'

Deno.test('extractSpreadsheetId pulls the id from a full URL or a bare id', () => {
  assertEquals(
    extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC-dEfG_hijklmnopqrstuvwxyz012345/edit#gid=0'),
    '1AbC-dEfG_hijklmnopqrstuvwxyz012345',
  )
  assertEquals(extractSpreadsheetId('1AbC-dEfG_hijklmnopqrstuvwxyz012345'), '1AbC-dEfG_hijklmnopqrstuvwxyz012345')
  assertEquals(extractSpreadsheetId('not a sheet'), null)
})

interface Captured {
  config?: Record<string, unknown>
}

function fakeAdminClient(captured: Captured, opts: { customerId?: string } = {}) {
  return () => ({
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_c: string, _v: string) {
              return {
                maybeSingle() {
                  return Promise.resolve({
                    data: {
                      config: { existing: true },
                      automation_requests: { customer_id: opts.customerId ?? 'cust-1' },
                    },
                    error: null,
                  })
                },
              }
            },
          }
        },
        update(payload: { config: Record<string, unknown> }) {
          captured.config = payload.config
          return { eq(_c: string, _v: string) { return Promise.resolve({ error: null }) } }
        },
      }
    },
  })
}

// Sheets fetch: the values read returns headers + a sample row; the metadata GET
// returns the spreadsheet title.
const sheetsFetcher: SheetsFetcher = (url) => {
  const u = url.toString()
  if (u.includes('/values/')) {
    return Promise.resolve(
      new Response(JSON.stringify({ values: [['Name', 'Telefon'], ['Anna Weber', '0176 1234567']] }), { status: 200 }),
    )
  }
  if (u.includes('fields=properties.title')) {
    return Promise.resolve(new Response(JSON.stringify({ properties: { title: 'Leads 2026' } }), { status: 200 }))
  }
  return Promise.resolve(new Response('{}', { status: 200 }))
}

function makeDeps(captured: Captured, overrides: Partial<ConfigureDeps> = {}): ConfigureDeps {
  return {
    createAdminClient: fakeAdminClient(captured) as never,
    getUserId: () => Promise.resolve('cust-1'),
    getAccessToken: () => Promise.resolve('access-token'),
    complete: () =>
      Promise.resolve(JSON.stringify([
        { field: 'Name', column: 'Name', confidence: 'high' },
        { field: 'Telefon', column: 'Telefon', confidence: 'high' },
      ])),
    sheetsFetcher,
    ...overrides,
  }
}

function postReq(bodyObj: unknown) {
  return new Request('http://localhost/connect-configure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake' },
    body: JSON.stringify(bodyObj),
  })
}

Deno.test('configures the mapping for the provision owner and writes it to config', async () => {
  const captured: Captured = {}
  const res = await handleConfigure(
    postReq({ provisionId: 'prov-1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc1234567890defghijk/edit' }),
    makeDeps(captured),
  )

  assertEquals(res.status, 200)
  const body = await res.json() as { proposedMapping: { sheetTitle: string; availableColumns: { value: string }[]; fields: { field: string; column: string | null }[] } }
  assertEquals(body.proposedMapping.sheetTitle, 'Leads 2026')
  assertEquals(body.proposedMapping.availableColumns.map((c) => c.value), ['Name', 'Telefon'])
  assertEquals(body.proposedMapping.fields.find((f) => f.field === 'Name')?.column, 'Name')

  // The proposal + the sheet id are persisted onto the provision config, merging
  // with what was already there.
  assertExists(captured.config)
  assertEquals((captured.config as { spreadsheetId: string }).spreadsheetId, 'abc1234567890defghijk')
  assertExists((captured.config as { proposedMapping: unknown }).proposedMapping)
  assertEquals((captured.config as { existing: boolean }).existing, true)
})

Deno.test('rejects a caller who does not own the provision (403, no write)', async () => {
  const captured: Captured = {}
  const res = await handleConfigure(
    postReq({ provisionId: 'prov-1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc1234567890defghijk/edit' }),
    // The provision belongs to cust-1, but the caller authenticates as someone else.
    makeDeps(captured, { getUserId: () => Promise.resolve('someone-else') }),
  )

  assertEquals(res.status, 403)
  assertEquals(captured.config, undefined)
})

Deno.test('rejects an unparseable sheet URL (400, no write)', async () => {
  const captured: Captured = {}
  const res = await handleConfigure(
    postReq({ provisionId: 'prov-1', spreadsheetUrl: 'just some text' }),
    makeDeps(captured),
  )
  assertEquals(res.status, 400)
  assertEquals(captured.config, undefined)
})

Deno.test('rejects an unauthenticated caller (401)', async () => {
  const captured: Captured = {}
  const res = await handleConfigure(
    postReq({ provisionId: 'prov-1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc1234567890defghijk/edit' }),
    makeDeps(captured, { getUserId: () => Promise.resolve(null) }),
  )
  assertEquals(res.status, 401)
  assertEquals(captured.config, undefined)
})
