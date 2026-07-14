import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import {
  buildDraftSystemPrompt,
  createGeminiDraftComplete,
  defaultScrape,
  draftConciergeFromUrl,
  parseDraft,
  plainFetchScrape,
  type ConciergeDraftDeps,
  type ResolveHostFn,
} from './conciergeDraft.ts'

// A server-rendered coach page, long enough to clear the fallback's
// shell-page threshold.
const REAL_PAGE_HTML =
  '<html><head><style>.x{}</style><script>var t=1</script></head><body>' +
  '<h1>Roman Kmenta</h1><p>' + 'Keynote Speaker und Vertriebsstratege. '.repeat(10) + '</p>' +
  '</body></html>'

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

Deno.test('defaultScrape without a key never calls Firecrawl, goes straight to the plain-fetch fallback', async () => {
  const seen: string[] = []
  const fetcher = ((u: string | URL | Request) => {
    seen.push(String(u))
    return Promise.resolve(new Response(REAL_PAGE_HTML, { status: 200 }))
  }) as typeof fetch
  const text = await defaultScrape('https://acme.com', fetcher, undefined)
  assertEquals(seen, ['https://acme.com'])
  assertEquals(text.includes('Keynote Speaker'), true)
})

Deno.test('defaultScrape surfaces the FIRECRAWL_API_KEY error when the key is missing AND the fallback fails', async () => {
  const fetcher = (() => Promise.resolve(new Response('nope', { status: 500 }))) as typeof fetch
  await assertRejects(() => defaultScrape('https://acme.com', fetcher, undefined), Error, 'FIRECRAWL_API_KEY')
})

// THE regression test for the live-demo failure: Firecrawl's credits were
// exhausted (HTTP 402), the wizard drafted nothing. The fallback must recover
// the draft for a server-rendered site.
Deno.test('defaultScrape falls back to plain fetch when Firecrawl returns 402 (credits exhausted)', async () => {
  const seen: string[] = []
  const fetcher = ((u: string | URL | Request) => {
    const url = String(u)
    seen.push(url)
    if (url === 'https://api.firecrawl.dev/v1/scrape') {
      return Promise.resolve(jsonResponse({ error: 'Insufficient credits' }, 402))
    }
    return Promise.resolve(new Response(REAL_PAGE_HTML, { status: 200 }))
  }) as typeof fetch
  const text = await defaultScrape('https://www.romankmenta.com', fetcher, 'fc-key')
  assertEquals(seen[0], 'https://api.firecrawl.dev/v1/scrape')
  assertEquals(seen[1], 'https://www.romankmenta.com')
  assertEquals(text.includes('Vertriebsstratege'), true)
  // Script/style bodies never leak into the draft grounding text.
  assertEquals(text.includes('var t=1'), false)
})

Deno.test('defaultScrape rethrows the ORIGINAL Firecrawl error when the fallback also fails', async () => {
  const fetcher = ((u: string | URL | Request) => {
    const url = String(u)
    if (url === 'https://api.firecrawl.dev/v1/scrape') {
      return Promise.resolve(jsonResponse({ error: 'rate limited' }, 429))
    }
    // The page itself is a JS shell: too little text to draft from.
    return Promise.resolve(new Response('<html><body><div id="app"></div></body></html>', { status: 200 }))
  }) as typeof fetch
  await assertRejects(() => defaultScrape('https://acme.com', fetcher, 'fc-key'), Error, 'scrape_failed_429')
})

Deno.test('defaultScrape falls back when the Firecrawl request itself rejects (network error)', async () => {
  const fetcher = ((u: string | URL | Request) => {
    if (String(u) === 'https://api.firecrawl.dev/v1/scrape') return Promise.reject(new TypeError('fetch failed'))
    return Promise.resolve(new Response(REAL_PAGE_HTML, { status: 200 }))
  }) as typeof fetch
  const text = await defaultScrape('https://acme.com', fetcher, 'fc-key')
  assertEquals(text.includes('Roman Kmenta'), true)
})

Deno.test('defaultScrape normalizes a non-Error Firecrawl rejection and still falls back', async () => {
  const fetcher = ((u: string | URL | Request) => {
    // A thrown string (not an Error) must not crash the orchestrator.
    if (String(u) === 'https://api.firecrawl.dev/v1/scrape') return Promise.reject('boom')
    return Promise.resolve(new Response(REAL_PAGE_HTML, { status: 200 }))
  }) as typeof fetch
  const text = await defaultScrape('https://acme.com', fetcher, 'fc-key')
  assertEquals(text.includes('Roman Kmenta'), true)
})

Deno.test('defaultScrape falls back when Firecrawl returns no usable markdown', async () => {
  const fetcher = ((u: string | URL | Request) => {
    if (String(u) === 'https://api.firecrawl.dev/v1/scrape') {
      return Promise.resolve(jsonResponse({ success: true, data: { markdown: '   ' } }))
    }
    return Promise.resolve(new Response(REAL_PAGE_HTML, { status: 200 }))
  }) as typeof fetch
  const text = await defaultScrape('https://acme.com', fetcher, 'fc-key')
  assertEquals(text.includes('Roman Kmenta'), true)
})

Deno.test('plainFetchScrape refuses private/internal hosts (SSRF guard), before any request', async () => {
  let called = false
  const fetcher = (() => {
    called = true
    return Promise.resolve(new Response(REAL_PAGE_HTML, { status: 200 }))
  }) as typeof fetch
  for (const bad of [
    'http://localhost/x', 'http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://192.168.1.1/x',
    'http://172.16.9.9/x', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/x', 'http://foo.internal/x',
    'http://100.64.0.1/x', // CGNAT
  ]) {
    await assertRejects(() => plainFetchScrape(bad, fetcher), Error, 'scrape_fallback_forbidden')
  }
  assertEquals(called, false)
})

// Pin the load-bearing assumption that the WHATWG URL parser normalises exotic
// IP encodings to dotted-quad/hex BEFORE the guard sees them — otherwise a
// decimal/octal/hex/short/mapped literal would slip past the string check.
Deno.test('plainFetchScrape refuses alternate encodings of internal IPs', async () => {
  let called = false
  const fetcher = (() => {
    called = true
    return Promise.resolve(new Response(REAL_PAGE_HTML, { status: 200 }))
  }) as typeof fetch
  for (const bad of [
    'http://2130706433/x',        // decimal 127.0.0.1
    'http://0x7f000001/x',        // hex 127.0.0.1
    'http://0177.0.0.1/x',        // octal 127.0.0.1
    'http://127.1/x',             // short 127.0.0.1
    'http://0.0.0.0/x',           // unspecified
    'http://[::ffff:127.0.0.1]/x', // IPv4-mapped IPv6 (parser stores it as ::ffff:7f00:1)
  ]) {
    await assertRejects(() => plainFetchScrape(bad, fetcher), Error, 'scrape_fallback_forbidden')
  }
  assertEquals(called, false)
})

// DNS rebinding: a perfectly public hostname whose A record points inward. The
// string guard can't see this — only the resolved-IP check can.
Deno.test('plainFetchScrape refuses a public host that RESOLVES to an internal IP', async () => {
  let called = false
  const fetcher = (() => {
    called = true
    return Promise.resolve(new Response(REAL_PAGE_HTML, { status: 200 }))
  }) as typeof fetch
  const rebinding = (() => Promise.resolve(['169.254.169.254'])) as ResolveHostFn
  await assertRejects(
    () => plainFetchScrape('https://totally-legit.example/x', fetcher, rebinding),
    Error,
    'scrape_fallback_forbidden',
  )
  assertEquals(called, false) // rejected before any fetch
})

Deno.test('plainFetchScrape allows a public host that resolves to a public IP', async () => {
  const fetcher = (() => Promise.resolve(new Response(REAL_PAGE_HTML, { status: 200 }))) as typeof fetch
  const publicResolve = (() => Promise.resolve(['93.184.216.34'])) as ResolveHostFn
  const text = await plainFetchScrape('https://example.com/x', fetcher, publicResolve)
  assertEquals(text.includes('Roman Kmenta'), true)
})

Deno.test('plainFetchScrape follows an allowed redirect (incl. a relative Location) and returns the text', async () => {
  const seen: string[] = []
  const fetcher = ((u: string | URL | Request) => {
    const url = String(u)
    seen.push(url)
    if (url === 'https://acme.com/') {
      // Relative Location: must resolve against the current URL, not throw.
      return Promise.resolve(new Response(null, { status: 301, headers: { location: '/de/' } }))
    }
    if (url === 'https://acme.com/de/') {
      return Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://www.acme.com/de/' } }))
    }
    return Promise.resolve(new Response(REAL_PAGE_HTML, { status: 200 }))
  }) as typeof fetch
  const text = await plainFetchScrape('https://acme.com/', fetcher)
  assertEquals(seen, ['https://acme.com/', 'https://acme.com/de/', 'https://www.acme.com/de/'])
  assertEquals(text.includes('Roman Kmenta'), true)
})

Deno.test('plainFetchScrape gives up on a redirect loop after 4 hops', async () => {
  let calls = 0
  const fetcher = (() => {
    calls++
    return Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://acme.com/loop' } }))
  }) as typeof fetch
  await assertRejects(() => plainFetchScrape('https://acme.com/', fetcher), Error, 'scrape_fallback_too_many_redirects')
  assertEquals(calls, 4)
})

Deno.test('plainFetchScrape rejects malformed redirects: no Location header, or a non-http(s) scheme', async () => {
  const noLocation = (() =>
    Promise.resolve(new Response(null, { status: 301 }))) as typeof fetch
  await assertRejects(() => plainFetchScrape('https://acme.com/', noLocation), Error, 'scrape_fallback_failed')

  // A redirect may point anywhere — ftp:// & co. must trip the protocol guard.
  const toFtp = (() =>
    Promise.resolve(new Response(null, { status: 302, headers: { location: 'ftp://internal-fileserver/secret' } }))) as typeof fetch
  await assertRejects(() => plainFetchScrape('https://acme.com/', toFtp), Error, 'scrape_fallback_forbidden')
})

Deno.test('plainFetchScrape follows a redirect but re-checks the guard on the new host', async () => {
  const seen: string[] = []
  const fetcher = ((u: string | URL | Request) => {
    const url = String(u)
    seen.push(url)
    if (url === 'https://acme.com/') {
      return Promise.resolve(new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/steal' } }))
    }
    return Promise.resolve(new Response(REAL_PAGE_HTML, { status: 200 }))
  }) as typeof fetch
  await assertRejects(() => plainFetchScrape('https://acme.com/', fetcher), Error, 'scrape_fallback_forbidden')
  assertEquals(seen, ['https://acme.com/'])
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

Deno.test('createGeminiDraftComplete retries a transient 503 then succeeds', async () => {
  let calls = 0
  const fetcher = (() => {
    calls++
    return Promise.resolve(
      calls < 2
        ? new Response('{}', { status: 503 })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"offer_description":"x"}' }] } }] }), { status: 200 }),
    )
  }) as typeof fetch
  const reply = await createGeminiDraftComplete('k', fetcher)('sys', 'page text')
  assertEquals(reply.includes('offer_description'), true)
  assertEquals(calls, 2)
})
