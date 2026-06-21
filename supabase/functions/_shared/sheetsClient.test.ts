import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1'
import { appendRow, readHeaderRow, type SheetsFetcher } from './sheetsClient.ts'

Deno.test('readHeaderRow returns the header row and first sample row', async () => {
  let calledUrl = ''
  let authHeader = ''
  const fetcher: SheetsFetcher = (url, init) => {
    calledUrl = url
    authHeader = new Headers(init?.headers).get('Authorization') ?? ''
    return Promise.resolve(
      new Response(
        JSON.stringify({ values: [['Name', 'Telefon', 'E-Mail'], ['Jan de Vries', '+31612345678', 'jan@example.nl']] }),
        { status: 200 },
      ),
    )
  }

  const result = await readHeaderRow('sheet-123', 'tok-abc', fetcher)

  assertEquals(result.headers, ['Name', 'Telefon', 'E-Mail'])
  assertEquals(result.sampleRow, ['Jan de Vries', '+31612345678', 'jan@example.nl'])
  assertStringIncludes(calledUrl, 'sheet-123')
  assertEquals(authHeader, 'Bearer tok-abc')
})

Deno.test('readHeaderRow tolerates a sheet with only a header (no data rows yet)', async () => {
  const fetcher: SheetsFetcher = () =>
    Promise.resolve(new Response(JSON.stringify({ values: [['Name', 'Telefon']] }), { status: 200 }))

  const result = await readHeaderRow('sheet-123', 'tok-abc', fetcher)
  assertEquals(result.headers, ['Name', 'Telefon'])
  assertEquals(result.sampleRow, [])
})

Deno.test('readHeaderRow tolerates a completely empty sheet', async () => {
  const fetcher: SheetsFetcher = () => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))

  const result = await readHeaderRow('sheet-123', 'tok-abc', fetcher)
  assertEquals(result.headers, [])
  assertEquals(result.sampleRow, [])
})

Deno.test('readHeaderRow surfaces the API error message on failure', async () => {
  const fetcher: SheetsFetcher = () =>
    Promise.resolve(new Response(JSON.stringify({ error: { message: 'The caller does not have permission' } }), { status: 403 }))

  await assertRejects(
    () => readHeaderRow('sheet-123', 'tok-abc', fetcher),
    Error,
    'does not have permission',
  )
})

Deno.test('appendRow uses values.append with INSERT_ROWS (append-only guarantee)', async () => {
  let calledUrl = ''
  let method = ''
  let body = ''
  const fetcher: SheetsFetcher = (url, init) => {
    calledUrl = url
    method = init?.method ?? ''
    body = init?.body?.toString() ?? ''
    return Promise.resolve(new Response(JSON.stringify({ updates: { updatedRows: 1 } }), { status: 200 }))
  }

  await appendRow('sheet-123', ['Jan', '+31612345678'], 'tok-abc', fetcher)

  assertEquals(method, 'POST')
  // The two flags that together make this strictly append-only.
  assertStringIncludes(calledUrl, ':append')
  assertStringIncludes(calledUrl, 'insertDataOption=INSERT_ROWS')
  // It must never call the overwriting endpoints.
  assertEquals(calledUrl.includes(':batchUpdate'), false)
  assertEquals(calledUrl.includes(':update'), false)
  assertStringIncludes(body, 'Jan')
  assertStringIncludes(body, '+31612345678')
})

Deno.test('appendRow throws on API failure', async () => {
  const fetcher: SheetsFetcher = () =>
    Promise.resolve(new Response(JSON.stringify({ error: { message: 'Unable to parse range' } }), { status: 400 }))

  await assertRejects(
    () => appendRow('sheet-123', ['Jan'], 'tok-abc', fetcher),
    Error,
    'Unable to parse range',
  )
})
