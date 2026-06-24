import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import {
  buildDraftSystemPrompt,
  draftConciergeFromUrl,
  parseDraft,
  type ConciergeDraftDeps,
} from './conciergeDraft.ts'

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
