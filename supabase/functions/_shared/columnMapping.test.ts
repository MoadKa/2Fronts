import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  createGeminiComplete,
  DEFAULT_LEAD_FIELDS,
  proposeColumnMapping,
  type CompleteFn,
} from './columnMapping.ts'

// A complete() that always returns the same canned JSON, regardless of prompt.
function cannedComplete(json: string): CompleteFn {
  return () => Promise.resolve(json)
}

Deno.test('proposeColumnMapping maps confident fields and returns them in requested order', async () => {
  const headers = ['Name', 'Telefon', 'E-Mail', 'Quelle', 'Datum']
  const complete = cannedComplete(JSON.stringify([
    { field: 'Name', column: 'Name', confidence: 'high' },
    { field: 'Telefon', column: 'Telefon', confidence: 'high' },
    { field: 'E-Mail', column: 'E-Mail', confidence: 'high' },
    { field: 'Quelle', column: 'Quelle', confidence: 'high' },
    { field: 'Datum', column: 'Datum', confidence: 'high' },
  ]))

  const result = await proposeColumnMapping(
    { headers, fields: DEFAULT_LEAD_FIELDS },
    { complete },
  )

  assertEquals(result, [
    { field: 'Name', column: 'Name', confidence: 'high' },
    { field: 'Telefon', column: 'Telefon', confidence: 'high' },
    { field: 'E-Mail', column: 'E-Mail', confidence: 'high' },
    { field: 'Quelle', column: 'Quelle', confidence: 'high' },
    { field: 'Datum', column: 'Datum', confidence: 'high' },
  ])
})

Deno.test('proposeColumnMapping maps across languages (Dutch headers)', async () => {
  const headers = ['Voornaam', 'GSM', 'Mail', 'Bron']
  const complete = cannedComplete(JSON.stringify([
    { field: 'Name', column: 'Voornaam', confidence: 'high' },
    { field: 'Telefon', column: 'GSM', confidence: 'high' },
    { field: 'E-Mail', column: 'Mail', confidence: 'high' },
    { field: 'Quelle', column: 'Bron', confidence: 'high' },
    // Datum: no matching column -> the model returns null.
    { field: 'Datum', column: null, confidence: 'low' },
  ]))

  const result = await proposeColumnMapping(
    { headers, fields: DEFAULT_LEAD_FIELDS },
    { complete },
  )

  assertEquals(result.find((r) => r.field === 'Name'), { field: 'Name', column: 'Voornaam', confidence: 'high' })
  assertEquals(result.find((r) => r.field === 'Telefon'), { field: 'Telefon', column: 'GSM', confidence: 'high' })
  // No column for Datum: must be null + low, never a guess.
  assertEquals(result.find((r) => r.field === 'Datum'), { field: 'Datum', column: null, confidence: 'low' })
})

Deno.test('proposeColumnMapping forces confidence to low whenever the column is null', async () => {
  const headers = ['Naam', 'Tel']
  // A misbehaving model claims high confidence on a null column -- we must not
  // trust it. A null column can never carry high confidence.
  const complete = cannedComplete(JSON.stringify([
    { field: 'Name', column: 'Naam', confidence: 'high' },
    { field: 'Telefon', column: 'Tel', confidence: 'high' },
    { field: 'E-Mail', column: null, confidence: 'high' },
    { field: 'Quelle', column: null, confidence: 'high' },
    { field: 'Datum', column: null, confidence: 'high' },
  ]))

  const result = await proposeColumnMapping(
    { headers, fields: DEFAULT_LEAD_FIELDS },
    { complete },
  )

  for (const field of ['E-Mail', 'Quelle', 'Datum']) {
    const entry = result.find((r) => r.field === field)!
    assertEquals(entry.column, null)
    assertEquals(entry.confidence, 'low', `${field} with a null column must be low confidence`)
  }
})

Deno.test('proposeColumnMapping NEVER invents a column the sheet does not have', async () => {
  const headers = ['Naam', 'Tel']
  // The model hallucinates a column 'Email' that is not in the header set.
  // We must drop it to null rather than write leads into a phantom column.
  const complete = cannedComplete(JSON.stringify([
    { field: 'Name', column: 'Naam', confidence: 'high' },
    { field: 'Telefon', column: 'Tel', confidence: 'high' },
    { field: 'E-Mail', column: 'Email', confidence: 'high' },
    { field: 'Quelle', column: 'Bron', confidence: 'low' },
    { field: 'Datum', column: 'Datum', confidence: 'high' },
  ]))

  const result = await proposeColumnMapping(
    { headers, fields: DEFAULT_LEAD_FIELDS },
    { complete },
  )

  // Hallucinated columns collapse to a safe unmapped result.
  assertEquals(result.find((r) => r.field === 'E-Mail'), { field: 'E-Mail', column: null, confidence: 'low' })
  assertEquals(result.find((r) => r.field === 'Quelle'), { field: 'Quelle', column: null, confidence: 'low' })
  assertEquals(result.find((r) => r.field === 'Datum'), { field: 'Datum', column: null, confidence: 'low' })
})

Deno.test('proposeColumnMapping fills in fields the model omitted entirely as null/low', async () => {
  const headers = ['Name', 'Telefon']
  // The model only answered for two fields; the rest must default safely.
  const complete = cannedComplete(JSON.stringify([
    { field: 'Name', column: 'Name', confidence: 'high' },
    { field: 'Telefon', column: 'Telefon', confidence: 'high' },
  ]))

  const result = await proposeColumnMapping(
    { headers, fields: DEFAULT_LEAD_FIELDS },
    { complete },
  )

  // Every requested field still appears exactly once.
  assertEquals(result.length, DEFAULT_LEAD_FIELDS.length)
  assertEquals(result.find((r) => r.field === 'E-Mail'), { field: 'E-Mail', column: null, confidence: 'low' })
})

Deno.test('proposeColumnMapping tolerates a model that wraps JSON in prose / a code fence', async () => {
  const headers = ['Name', 'Telefon']
  const complete = cannedComplete(
    'Here is the mapping you asked for:\n```json\n' +
      JSON.stringify([
        { field: 'Name', column: 'Name', confidence: 'high' },
        { field: 'Telefon', column: 'Telefon', confidence: 'high' },
      ]) +
      '\n```\nLet me know if you need anything else.',
  )

  const result = await proposeColumnMapping(
    { headers, fields: DEFAULT_LEAD_FIELDS },
    { complete },
  )

  assertEquals(result.find((r) => r.field === 'Name'), { field: 'Name', column: 'Name', confidence: 'high' })
})

Deno.test('proposeColumnMapping rejects when the model returns no parseable array', async () => {
  await assertRejects(
    () =>
      proposeColumnMapping(
        { headers: ['Name'], fields: DEFAULT_LEAD_FIELDS },
        { complete: cannedComplete('I could not produce a mapping.') },
      ),
    Error,
    'did not contain a JSON array',
  )
})

Deno.test('createGeminiComplete throws a clear error when the API key is missing (and never prints it)', () => {
  let threw: Error | null = null
  try {
    createGeminiComplete(undefined, () => Promise.resolve(new Response('{}')))
  } catch (e) {
    threw = e as Error
  }
  assertEquals(threw !== null, true)
  assertStringIncludes(threw!.message, 'GEMINI_API_KEY')
})

Deno.test('createGeminiComplete sends the key as a header (not URL or body) and returns the text', async () => {
  let sentApiKey = ''
  let sentUrl = ''
  let sentBody = ''
  const fetcher = (url: string, init?: RequestInit) => {
    sentUrl = url
    sentApiKey = new Headers(init?.headers).get('x-goog-api-key') ?? ''
    sentBody = init?.body?.toString() ?? ''
    return Promise.resolve(
      new Response(
        JSON.stringify({
          candidates: [{
            content: {
              parts: [{ text: '[{"field":"Name","column":"Name","confidence":"high"}]' }],
            },
          }],
        }),
        { status: 200 },
      ),
    )
  }

  const complete = createGeminiComplete('secret-key-123', fetcher)
  const text = await complete('map these columns')

  assertEquals(sentApiKey, 'secret-key-123')
  // The key must never leak into the request URL (logged) or the body.
  assertEquals(sentUrl.includes('secret-key-123'), false)
  assertEquals(sentBody.includes('secret-key-123'), false)
  assertStringIncludes(text, '"field":"Name"')
})

Deno.test('createGeminiComplete surfaces the API error message on failure', async () => {
  const fetcher = () =>
    Promise.resolve(new Response(JSON.stringify({ error: { message: 'RESOURCE_EXHAUSTED' } }), { status: 429 }))

  const complete = createGeminiComplete('secret-key-123', fetcher)
  await assertRejects(() => complete('x'), Error, 'RESOURCE_EXHAUSTED')
})
