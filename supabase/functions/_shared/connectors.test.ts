import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1'
import {
  getConnector,
  googleSheetsConnector,
  twilioMissedCallConnector,
  type Connector,
} from './connectors.ts'
import type { SheetsFetcher } from './sheetsClient.ts'

// A minimal admin client that records update() patches, mirroring the shape
// attemptProvision drives (update -> eq -> select -> maybeSingle).
function fakeAdminClient(claimSucceeds: boolean, provisionRow: { id: string; business_name: string }) {
  const updates: { patch: unknown; matchedStatus?: string }[] = []
  const client = {
    updates,
    from() {
      return {
        update(patch: unknown) {
          const record: { patch: unknown; matchedStatus?: string } = { patch }
          updates.push(record)
          const builder = {
            eq(col: string, val: unknown) {
              if (col === 'status') record.matchedStatus = val as string
              return builder
            },
            select() {
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: claimSucceeds ? { ...provisionRow, ...(patch as object) } : null,
                    error: null,
                  }),
              }
            },
          }
          return builder
        },
      }
    },
  }
  return client
}

Deno.test('getConnector resolves the twilio connector by type', () => {
  assertEquals(getConnector('twilio_missed_call'), twilioMissedCallConnector)
})

Deno.test('getConnector defaults a null/undefined type to the missed-call connector', () => {
  // Legacy rows written before connector_type existed arrive as null.
  assertEquals(getConnector(null), twilioMissedCallConnector)
  assertEquals(getConnector(undefined), twilioMissedCallConnector)
})

Deno.test('getConnector throws on an unregistered type rather than silently no-op', () => {
  assertThrows(() => getConnector('totally_unknown'), Error, 'No connector registered')
})

Deno.test('getConnector consults an injected registry', () => {
  const fake: Connector = { connectorType: 'fake', provision: () => Promise.resolve('active') }
  assertEquals(getConnector('fake', { fake }), fake)
})

Deno.test('twilio connector provisions through attemptProvision and persists the number', async () => {
  const client = fakeAdminClient(true, { id: 'prov-1', business_name: 'Acme Plumbing' })
  let purchasedFor = ''

  const result = await twilioMissedCallConnector.provision({
    adminClient: client as never,
    row: { id: 'prov-1', connector_type: 'twilio_missed_call', business_name: 'Acme Plumbing' },
    fromStatus: 'pending',
    deps: {
      provisionAutomation: {
        purchaseNumber: (businessName: string) => {
          purchasedFor = businessName
          return Promise.resolve({ phoneNumber: '+31612345678', sid: 'PN123' })
        },
      },
    },
  })

  assertEquals(result, 'active')
  assertEquals(purchasedFor, 'Acme Plumbing')
  assertEquals(client.updates[0].matchedStatus, 'pending')
  assertEquals((client.updates[1].patch as { status: string }).status, 'active')
})

Deno.test('twilio connector fails loudly when its provisionAutomation dep is missing', async () => {
  await assertRejects(
    () =>
      twilioMissedCallConnector.provision({
        adminClient: fakeAdminClient(true, { id: 'prov-1', business_name: 'Acme' }) as never,
        row: { id: 'prov-1', connector_type: 'twilio_missed_call', business_name: 'Acme' },
        fromStatus: 'pending',
        deps: {},
      }),
    Error,
    'requires the provisionAutomation dependency',
  )
})

// --- google_sheets connector -------------------------------------------------

Deno.test('getConnector resolves the google_sheets connector by type', () => {
  assertEquals(getConnector('google_sheets'), googleSheetsConnector)
})

// A SheetsFetcher serving a fixed header/sample for reads and recording appends.
function fakeSheets(headerValues: string[][]) {
  const appends: { url: string; body: string }[] = []
  const fetcher: SheetsFetcher = (url, init) => {
    if (url.includes(':append')) {
      appends.push({ url, body: init?.body?.toString() ?? '' })
      return Promise.resolve(new Response(JSON.stringify({ updates: { updatedRows: 1 } }), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify({ values: headerValues }), { status: 200 }))
  }
  return { fetcher, appends }
}

Deno.test('google_sheets configure proposes a mapping from the header row', async () => {
  const { fetcher } = fakeSheets([['Naam', 'GSM', 'Mail'], ['Jan', '+316', 'jan@x.nl']])
  // Deterministic LLM: maps the three present fields, nulls the rest.
  const complete = () =>
    Promise.resolve(JSON.stringify([
      { field: 'Name', column: 'Naam', confidence: 'high' },
      { field: 'Telefon', column: 'GSM', confidence: 'high' },
      { field: 'E-Mail', column: 'Mail', confidence: 'high' },
      { field: 'Quelle', column: null, confidence: 'low' },
      { field: 'Datum', column: null, confidence: 'low' },
    ]))

  const result = await googleSheetsConnector.configure!({
    row: { id: 'p1', connector_type: 'google_sheets', config: { spreadsheetId: 'sheet-1' } },
    deps: { getAccessToken: () => Promise.resolve('tok'), sheetsFetcher: fetcher, complete },
  })

  assertEquals(result.headers, ['Naam', 'GSM', 'Mail'])
  assertEquals(result.proposedMapping.find((m) => m.field === 'Name')?.column, 'Naam')
  assertEquals(result.proposedMapping.find((m) => m.field === 'Datum')?.column, null)
})

Deno.test('google_sheets run files a lead with an append-only, header-aligned write', async () => {
  const { fetcher, appends } = fakeSheets([['Naam', 'GSM', 'Mail']])

  const result = await googleSheetsConnector.run!({
    row: {
      id: 'p1',
      connector_type: 'google_sheets',
      config: {
        spreadsheetId: 'sheet-1',
        columnMapping: [
          { field: 'Name', column: 'Naam', confidence: 'high' },
          { field: 'Telefon', column: 'GSM', confidence: 'high' },
          { field: 'E-Mail', column: 'Mail', confidence: 'high' },
        ],
      },
    },
    lead: { id: 'l1', payload: { Name: 'Jan', Telefon: '+316', 'E-Mail': 'jan@x.nl' } },
    deps: { getAccessToken: () => Promise.resolve('tok'), sheetsFetcher: fetcher },
  })

  assertEquals(result.outcome, 'filed')
  assertEquals(appends.length, 1)
  // Values land under their headers, in header order.
  assertStringIncludes(appends[0].body, 'Jan')
  assertStringIncludes(appends[0].body, '+316')
  assertStringIncludes(appends[0].body, 'jan@x.nl')
  // It used the append (insert-rows) endpoint, never an overwrite.
  assertStringIncludes(appends[0].url, ':append')
})

Deno.test('google_sheets run holds for review when there is no confirmed mapping', async () => {
  const { fetcher, appends } = fakeSheets([['Naam']])

  const result = await googleSheetsConnector.run!({
    row: { id: 'p1', connector_type: 'google_sheets', config: { spreadsheetId: 'sheet-1' } },
    lead: { id: 'l1', payload: { Name: 'Jan' } },
    deps: { getAccessToken: () => Promise.resolve('tok'), sheetsFetcher: fetcher },
  })

  assertEquals(result.outcome, 'needs_review')
  // Nothing was written -- a needs_review lead never touches the sheet.
  assertEquals(appends.length, 0)
})

Deno.test('google_sheets run holds for review when a mapped field is missing from the lead', async () => {
  const { fetcher, appends } = fakeSheets([['Naam', 'GSM']])

  const result = await googleSheetsConnector.run!({
    row: {
      id: 'p1',
      connector_type: 'google_sheets',
      config: {
        spreadsheetId: 'sheet-1',
        columnMapping: [
          { field: 'Name', column: 'Naam', confidence: 'high' },
          { field: 'Telefon', column: 'GSM', confidence: 'high' },
        ],
      },
    },
    // Telefon is mapped but absent -> we must not file a half-known row.
    lead: { id: 'l1', payload: { Name: 'Jan' } },
    deps: { getAccessToken: () => Promise.resolve('tok'), sheetsFetcher: fetcher },
  })

  assertEquals(result.outcome, 'needs_review')
  assertStringIncludes(result.reason ?? '', 'Telefon')
  assertEquals(appends.length, 0)
})

Deno.test('google_sheets run holds for review when the mapped column drifted out of the sheet', async () => {
  // The sheet now lacks the 'GSM' column the mapping expects.
  const { fetcher, appends } = fakeSheets([['Naam', 'Email']])

  const result = await googleSheetsConnector.run!({
    row: {
      id: 'p1',
      connector_type: 'google_sheets',
      config: {
        spreadsheetId: 'sheet-1',
        columnMapping: [
          { field: 'Name', column: 'Naam', confidence: 'high' },
          { field: 'Telefon', column: 'GSM', confidence: 'high' },
        ],
      },
    },
    lead: { id: 'l1', payload: { Name: 'Jan', Telefon: '+316' } },
    deps: { getAccessToken: () => Promise.resolve('tok'), sheetsFetcher: fetcher },
  })

  assertEquals(result.outcome, 'needs_review')
  assertStringIncludes(result.reason ?? '', 'GSM')
  assertEquals(appends.length, 0)
})

Deno.test('google_sheets run reports failed (not filed) when the append call errors', async () => {
  const fetcher: SheetsFetcher = (url) => {
    if (url.includes(':append')) {
      return Promise.resolve(new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 }))
    }
    return Promise.resolve(new Response(JSON.stringify({ values: [['Naam']] }), { status: 200 }))
  }

  const result = await googleSheetsConnector.run!({
    row: {
      id: 'p1',
      connector_type: 'google_sheets',
      config: {
        spreadsheetId: 'sheet-1',
        columnMapping: [{ field: 'Name', column: 'Naam', confidence: 'high' }],
      },
    },
    lead: { id: 'l1', payload: { Name: 'Jan' } },
    deps: { getAccessToken: () => Promise.resolve('tok'), sheetsFetcher: fetcher },
  })

  assertEquals(result.outcome, 'failed')
  assertStringIncludes(result.reason ?? '', 'quota exceeded')
})

Deno.test('google_sheets configure fails loudly when getAccessToken is missing', async () => {
  await assertRejects(
    () =>
      googleSheetsConnector.configure!({
        row: { id: 'p1', config: { spreadsheetId: 'sheet-1' } },
        deps: { complete: () => Promise.resolve('[]') },
      }),
    Error,
    'getAccessToken',
  )
})
