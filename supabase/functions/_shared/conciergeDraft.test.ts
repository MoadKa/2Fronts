import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import {
  buildDraftSystemPrompt,
  defaultScrape,
  draftConciergeFromUrl,
  parseDraft,
  type ConciergeDraftDeps,
} from './conciergeDraft.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.test('buildDraftSystemPrompt pins the output language and forbids invention', () => {
  const en = buildDraftSystemPrompt('en')
  assertEquals(en.includes('English'), true)
  assertEquals(en.includes('Do NOT invent'), true)
  const de = buildDraftSystemPrompt('de')
  assertEquals(de.includes('German'), true)
})

Deno.test('parseDraft accepts a clean JSON object', () => {
  const d = parseDraft(JSON.stringify({
    offer_description: ' coaching ',
    qa: 'Q? — A.',
    tone: 'professional',
    calendar_url: 'https://cal.com/x',
  }))
  assertEquals(d.offer_description, 'coaching')
  assertEquals(d.tone, 'professional')
  assertEquals(d.calendar_url, 'https://cal.com/x')
})

Deno.test('parseDraft tolerates ```json fences', () => {
  const d = parseDraft('```json\n{"offer_description":"x","tone":"casual"}\n```')
  assertEquals(d.offer_description, 'x')
  assertEquals(d.tone, 'casual')
})

Deno.test('parseDraft drops invalid tone and non-http calendar links', () => {
  const d = parseDraft(JSON.stringify({ tone: 'angry', calendar_url: 'mailto:x@y.com' }))
  assertEquals(d.tone, undefined)
  assertEquals(d.calendar_url, undefined)
})

Deno.test('parseDraft throws on unparseable output', () => {
  try {
    parseDraft('not json at all')
    throw new Error('should have thrown')
  } catch (e) {
    assertEquals((e as Error).message, 'draft_unparseable')
  }
})

Deno.test('draftConciergeFromUrl orchestrates scrape -> llm -> parse', async () => {
  const deps: ConciergeDraftDeps = {
    scrape: () => Promise.resolve('Acme — we coach founders.'),
    complete: (_s, page) => {
      assertEquals(page.includes('Acme'), true)
      return Promise.resolve('{"offer_description":"coach founders","tone":"friendly"}')
    },
  }
  const d = await draftConciergeFromUrl('https://acme.com', 'en', deps)
  assertEquals(d.offer_description, 'coach founders')
})

Deno.test('draftConciergeFromUrl throws on an empty page', async () => {
  const deps: ConciergeDraftDeps = {
    scrape: () => Promise.resolve('   '),
    complete: () => Promise.resolve('{}'),
  }
  await assertRejects(() => draftConciergeFromUrl('https://acme.com', 'en', deps), Error, 'empty_page')
})

Deno.test('defaultScrape calls Firecrawl with the key in the Authorization header and returns markdown', async () => {
  let seenUrl = ''
  let seenAuth = ''
  let seenBody = ''
  const fetcher = ((u: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(u)
    seenAuth = String((init?.headers as Record<string, string>)?.Authorization ?? '')
    seenBody = String(init?.body ?? '')
    return Promise.resolve(jsonResponse({ success: true, data: { markdown: '# Acme\nWe coach founders.' } }))
  }) as typeof fetch
  const text = await defaultScrape('https://acme.com', fetcher, 'fc-key')
  assertEquals(seenUrl, 'https://api.firecrawl.dev/v1/scrape')
  assertEquals(seenAuth, 'Bearer fc-key')
  assertEquals(seenBody.includes('https://acme.com'), true)
  assertEquals(text.includes('We coach founders.'), true)
})

Deno.test('defaultScrape throws when the FIRECRAWL_API_KEY is missing (never calls out)', async () => {
  let called = false
  const fetcher = (() => {
    called = true
    return Promise.resolve(jsonResponse({}))
  }) as typeof fetch
  await assertRejects(() => defaultScrape('https://acme.com', fetcher, undefined), Error, 'FIRECRAWL_API_KEY')
  assertEquals(called, false)
})

Deno.test('defaultScrape throws scrape_failed_<status> on a non-ok Firecrawl response', async () => {
  const fetcher = (() => Promise.resolve(jsonResponse({ error: 'rate limited' }, 429))) as typeof fetch
  await assertRejects(() => defaultScrape('https://acme.com', fetcher, 'fc-key'), Error, 'scrape_failed_429')
})

Deno.test('defaultScrape throws scrape_empty when Firecrawl returns no usable markdown', async () => {
  const fetcher = (() => Promise.resolve(jsonResponse({ success: true, data: { markdown: '   ' } }))) as typeof fetch
  await assertRejects(() => defaultScrape('https://acme.com', fetcher, 'fc-key'), Error, 'scrape_empty')
})

Deno.test('defaultScrape rejects a non-http url before calling out', async () => {
  let called = false
  const fetcher = (() => {
    called = true
    return Promise.resolve(jsonResponse({}))
  }) as typeof fetch
  await assertRejects(() => defaultScrape('ftp://nope', fetcher, 'fc-key'), Error, 'invalid_url')
  assertEquals(called, false)
})
