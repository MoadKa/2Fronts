import { assertEquals } from 'jsr:@std/assert@1'
import { handleDraftFromUrl, type DraftFromUrlDeps } from './index.ts'
import type { ConciergeDraftDeps } from '../_shared/conciergeDraft.ts'

function req(body: unknown, auth = 'Bearer token'): Request {
  return new Request('http://local/concierge-draft-from-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  })
}

const okAuth = (): Promise<string | null> => Promise.resolve('user-1')

// A draftDeps with canned scrape + LLM so the test runs offline.
function cannedDraftDeps(pageText: string, llmReply: string): ConciergeDraftDeps {
  return {
    scrape: () => Promise.resolve(pageText),
    complete: () => Promise.resolve(llmReply),
  }
}

Deno.test('integration: scrape + Gemini success prefills the draft', async () => {
  const llm = JSON.stringify({
    offer_description: 'We coach founders to their first 10 customers.',
    qa: 'What does it cost? — From 200/mo.',
    tone: 'friendly',
    calendar_url: 'https://cal.com/acme',
  })
  const deps: DraftFromUrlDeps = {
    getUserId: okAuth,
    draftDeps: cannedDraftDeps('Acme Coaching — we coach founders. Book at cal.com/acme', llm),
  }
  const res = await handleDraftFromUrl(req({ url: 'https://acme.com', language: 'en' }), deps)
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.draft.offer_description, 'We coach founders to their first 10 customers.')
  assertEquals(json.draft.tone, 'friendly')
  assertEquals(json.draft.calendar_url, 'https://cal.com/acme')
})

Deno.test('integration: scrape failure returns 502 so the wizard falls back to manual', async () => {
  const deps: DraftFromUrlDeps = {
    getUserId: okAuth,
    draftDeps: {
      scrape: () => Promise.reject(new Error('scrape_failed_500')),
      complete: () => Promise.resolve('{}'),
    },
  }
  const res = await handleDraftFromUrl(req({ url: 'https://down.example' }), deps)
  assertEquals(res.status, 502)
  const json = await res.json()
  assertEquals(json.error, 'draft_failed')
})

Deno.test('rejects an unauthenticated caller', async () => {
  const deps: DraftFromUrlDeps = {
    getUserId: () => Promise.resolve(null),
    draftDeps: cannedDraftDeps('x', '{}'),
  }
  const res = await handleDraftFromUrl(req({ url: 'https://acme.com' }, ''), deps)
  assertEquals(res.status, 401)
})

Deno.test('rejects a non-http url before scraping', async () => {
  let scraped = false
  const deps: DraftFromUrlDeps = {
    getUserId: okAuth,
    draftDeps: {
      scrape: () => {
        scraped = true
        return Promise.resolve('x')
      },
      complete: () => Promise.resolve('{}'),
    },
  }
  const res = await handleDraftFromUrl(req({ url: 'ftp://nope' }), deps)
  assertEquals(res.status, 400)
  assertEquals(scraped, false)
})
