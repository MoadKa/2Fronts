// The scrape-accelerator brain for the onboarding wizard (#26): given a coach's
// website, fetch the page text and have Gemini draft a first concierge profile
// the coach then edits. A sibling of conciergeChat.ts / columnMapping.ts — same
// posture: the two external effects (scrape + LLM) are INJECTABLE so the handler
// is unit-tested offline, and the real Gemini client reuses the exact
// key-in-header / never-log posture.
//
// This is an ACCELERATOR, never a gate. Any failure (scrape down, LLM error,
// unparseable reply) surfaces as a thrown Error the edge fn turns into a 502;
// the wizard catches it and falls back to manual entry with no error wall.

import { geminiFetchWithRetry } from './geminiRetry.ts'

export type ConciergeLanguage = 'de' | 'en'

// The draft we hand back to the wizard. Every field is optional: the coach edits
// whatever we got and fills the rest. calendar_url is only set when the page
// actually links a scheduler.
export interface ConciergeDraft {
  offer_description?: string
  qa?: string
  tone?: 'friendly' | 'professional' | 'casual'
  calendar_url?: string
}

// Fetch the readable text of a page. Injectable; the default (defaultScrape)
// uses Firecrawl with a plain-fetch fallback, but tests pass canned page text.
export type ScrapeFn = (url: string) => Promise<string>

// Turn a system prompt + the page text into the model's JSON draft. Injectable
// (mirrors columnMapping's CompleteFn) so tests are deterministic and offline.
export type DraftCompleteFn = (system: string, pageText: string) => Promise<string>

export interface ConciergeDraftDeps {
  scrape: ScrapeFn
  complete: DraftCompleteFn
}

function languageName(language: ConciergeLanguage): string {
  return language === 'en' ? 'English' : 'German'
}

// Build the prompt that asks Gemini for a STRICT-JSON concierge draft in the
// coach's language, grounded only in the scraped page (never invent facts).
export function buildDraftSystemPrompt(language: ConciergeLanguage): string {
  return [
    'You help a coach set up an AI booking assistant by drafting a first version',
    'of their assistant profile from their own website.',
    '',
    `Write offer_description and qa in ${languageName(language)}.`,
    '',
    'Return ONLY a JSON object with these keys (no markdown, no prose):',
    '{',
    '  "offer_description": string,  // one short paragraph: what they offer, for whom, the outcome',
    '  "qa": string,                 // a few likely Q&A pairs, one per line ("Question? — Answer."), or "" if unknown',
    '  "tone": "friendly" | "professional" | "casual",  // the voice the site uses',
    '  "calendar_url": string        // a Calendly/Cal.com/scheduling link IF one appears on the page, else ""',
    '}',
    '',
    'RULES:',
    '- Use ONLY what the page actually says. Do NOT invent prices, guarantees, or facts.',
    '- If the page has too little to go on, return short best-effort values; never fabricate.',
    '- Output must be valid JSON and nothing else.',
  ].join('\n')
}

const VALID_TONES = new Set(['friendly', 'professional', 'casual'])

// Parse + sanitise the model's reply into a ConciergeDraft. Tolerates a JSON
// object possibly wrapped in ```json fences. Drops anything that isn't the
// expected shape rather than trusting raw model output.
export function parseDraft(raw: string): ConciergeDraft {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('draft_unparseable')
  }
  const draft: ConciergeDraft = {}
  if (typeof obj.offer_description === 'string') draft.offer_description = obj.offer_description.trim()
  if (typeof obj.qa === 'string') draft.qa = obj.qa.trim()
  if (typeof obj.tone === 'string' && VALID_TONES.has(obj.tone)) {
    draft.tone = obj.tone as ConciergeDraft['tone']
  }
  if (typeof obj.calendar_url === 'string' && obj.calendar_url.trim()) {
    const v = obj.calendar_url.trim()
    if (/^https?:\/\//i.test(v)) draft.calendar_url = v
  }
  return draft
}

// Orchestrate: scrape the URL, draft from the page text, parse the reply. Throws
// on any failure (the edge fn maps to 502, the wizard falls back to manual).
export async function draftConciergeFromUrl(
  url: string,
  language: ConciergeLanguage,
  deps: ConciergeDraftDeps,
): Promise<ConciergeDraft> {
  const pageText = await deps.scrape(url)
  if (!pageText || !pageText.trim()) throw new Error('empty_page')
  const system = buildDraftSystemPrompt(language)
  // Bound the page text so a huge page can't blow the prompt budget.
  const reply = await deps.complete(system, pageText.slice(0, 12000))
  return parseDraft(reply)
}

// ---------------------------------------------------------------------------
// Default real implementations.

const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1/scrape'

// Per-request wall clock. Without it a slow/never-responding server (or a
// slow-loris trickle) holds the edge invocation open indefinitely.
const FETCH_TIMEOUT_MS = 15_000

// Scrape via Firecrawl (primary). Renders JS and gets past bot-blocking, which
// a plain fetch can't for builder sites (Wix/Squarespace/Framer). The key goes
// ONLY in the Authorization header, never the URL/a log/an error.
async function firecrawlScrape(url: string, fetcher: typeof fetch, apiKey: string): Promise<string> {
  const res = await fetcher(FIRECRAWL_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`scrape_failed_${res.status}`)
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { markdown?: string } }
  const markdown = data?.data?.markdown ?? ''
  if (!data?.success || !markdown.trim()) throw new Error('scrape_empty')
  return markdown
}

// SSRF guard for the plain-fetch fallback: this runs server-side with a
// user-supplied URL, so refuse anything pointing at a private/loopback/
// link-local/metadata address. Two layers, because a string check alone is not
// enough: (1) the hostname string (catches literal IPs — the WHATWG URL parser
// already normalises decimal/octal/hex/short IPv4 like http://2130706433/ to
// dotted-quad before we see it — plus localhost-family names), and (2) the
// RESOLVED IPs (catches DNS rebinding: a public name whose A/AAAA record points
// inward). Both the initial URL and every redirect hop go through both layers.

// True if a raw IPv4 literal is loopback/private/link-local/CGNAT/unspecified.
function isForbiddenIpv4(h: string): boolean {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||             // link-local (incl. cloud metadata 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||    // private
    (a === 192 && b === 168) ||             // private
    (a === 100 && b >= 64 && b <= 127) ||   // CGNAT
    a >= 224                                // multicast (224/4) + reserved/broadcast (240/4, 255.255.255.255)
  )
}

// True if a raw IPv6 literal (bracketed or not) is loopback/unique-local/
// link-local, or an IPv4-mapped address whose embedded v4 is forbidden. The
// WHATWG parser compresses ::ffff:127.0.0.1 to the HEX form ::ffff:7f00:1, so
// both the dotted and hex spellings of the mapped tail are decoded.
function isForbiddenIpv6(h: string): boolean {
  const v = h.toLowerCase().replace(/^\[|\]$/g, '')
  if (v === '::1' || v === '::' || v === '::0') return true
  if (/^f[cd][0-9a-f]{2}:/.test(v)) return true // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(v)) return true // fe80::/10 link-local
  const dotted = v.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (dotted) return isForbiddenIpv4(dotted[1])
  const hex = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const hi = parseInt(hex[1], 16)
    const lo = parseInt(hex[2], 16)
    return isForbiddenIpv4([(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.'))
  }
  return false
}

// Layer 1: reject on the hostname STRING (localhost-family names + IP literals).
function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h.startsWith('[') || h.includes(':')) return isForbiddenIpv6(h) || h === '::1'
  return isForbiddenIpv4(h)
}

// Layer 2: resolve a hostname to its IPs and reject if any is internal. This
// raises the bar on DNS-based SSRF (a public name with a static internal A
// record is blocked outright) but does NOT fully close a rebinding attacker who
// controls an authoritative server and answers our resolve and fetch's own
// resolve differently (TOCTOU): Deno's fetch re-resolves by name, and it has no
// first-class connect-to-IP-with-Host-header, so we can't pin the vetted IP.
// Residual accepted for this authenticated-coach-only fallback; the real fix is
// IP-pinning at the transport, tracked separately. Injectable for offline tests;
// "cannot resolve" (no net permission in tests, NXDOMAIN) is treated as "no IPs
// to object to" — Layer 1 still stands and a truly unresolvable host fails at fetch.
export type ResolveHostFn = (hostname: string) => Promise<string[]>

const defaultResolveHost: ResolveHostFn = async (hostname) => {
  const D = (globalThis as { Deno?: { resolveDns?: (h: string, t: string) => Promise<string[]> } }).Deno
  if (!D?.resolveDns) return []
  const ips: string[] = []
  for (const type of ['A', 'AAAA']) {
    try {
      ips.push(...(await D.resolveDns(hostname, type)))
    } catch {
      /* NXDOMAIN for that record type, or net permission denied in tests */
    }
  }
  return ips
}

const MAX_REDIRECT_HOPS = 4
const MAX_FALLBACK_HTML_BYTES = 1_000_000

// Strip a fetched HTML document down to its readable text.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

// A JS-shell page (builder site) strips down to almost nothing — below this the
// fallback treats the page as unreadable rather than drafting from boilerplate.
const MIN_FALLBACK_TEXT = 150

// Read a response body but stop at maxBytes INSTEAD of buffering it whole — a
// hostile (or broken) page could otherwise stream gigabytes and OOM the isolate.
async function readCappedText(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes) // bodyless/mocked responses
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        parts.push(value)
        total += value.byteLength
      }
    }
  } finally {
    try {
      await reader.cancel() // stop the download; no-op if already drained
    } catch {
      /* already closed */
    }
  }
  const merged = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    merged.set(p, off)
    off += p.byteLength
  }
  return new TextDecoder().decode(merged).slice(0, maxBytes)
}

// Both SSRF layers for one hostname: string check, then resolved-IP check.
async function assertHostAllowed(hostname: string, resolveHost: ResolveHostFn): Promise<void> {
  if (isForbiddenHost(hostname)) throw new Error('scrape_fallback_forbidden')
  // A literal IP was already fully vetted by Layer 1; resolving it is a no-op.
  const isIpLiteral =
    hostname.startsWith('[') || hostname.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
  if (isIpLiteral) return
  for (const ip of await resolveHost(hostname)) {
    if (isForbiddenIpv4(ip) || isForbiddenIpv6(ip)) throw new Error('scrape_fallback_forbidden')
  }
}

// Plain-fetch fallback: fetch the page directly and extract its text. Works for
// server-rendered sites (WordPress & co. — a large share of coach sites) when
// Firecrawl is unavailable. Redirects are followed manually so every hop passes
// the SSRF guard (string + resolved IP); the response is size-capped.
export async function plainFetchScrape(
  url: string,
  fetcher: typeof fetch = fetch,
  resolveHost: ResolveHostFn = defaultResolveHost,
): Promise<string> {
  let current = url
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    const parsed = new URL(current)
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('scrape_fallback_forbidden')
    await assertHostAllowed(parsed.hostname, resolveHost)
    const res = await fetcher(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; 2FrontsBot/1.0; +https://2fronts.de)',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error('scrape_fallback_failed')
      current = new URL(loc, current).toString()
      continue
    }
    if (!res.ok) throw new Error(`scrape_fallback_${res.status}`)
    const html = await readCappedText(res, MAX_FALLBACK_HTML_BYTES)
    const text = htmlToText(html)
    if (text.length < MIN_FALLBACK_TEXT) throw new Error('scrape_fallback_empty')
    return text
  }
  throw new Error('scrape_fallback_too_many_redirects')
}

// Scrape a page's readable text. Firecrawl first (renders JS, bypasses bot
// blocks); when it can't deliver — key missing, credits exhausted (the 402 that
// silently emptied the wizard draft), rate-limited, or an empty result — fall
// back to fetching the page directly, which covers server-rendered sites. Only
// when BOTH fail does this throw, and it rethrows the FIRECRAWL error so the
// log shows the actionable cause (e.g. scrape_failed_402 = top up credits).
export async function defaultScrape(
  url: string,
  fetcher: typeof fetch = fetch,
  apiKey: string | undefined = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get('FIRECRAWL_API_KEY'),
  resolveHost: ResolveHostFn = defaultResolveHost,
): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('invalid_url')
  let firecrawlError: Error
  if (apiKey) {
    try {
      return await firecrawlScrape(url, fetcher, apiKey)
    } catch (e) {
      firecrawlError = e instanceof Error ? e : new Error('scrape_failed')
    }
  } else {
    firecrawlError = new Error('FIRECRAWL_API_KEY is not set; cannot scrape the page')
  }
  try {
    return await plainFetchScrape(url, fetcher, resolveHost)
  } catch (fallbackError) {
    // Rethrow the FIRECRAWL error (the actionable cause, e.g. scrape_failed_402),
    // but keep the fallback's own failure as `cause` so the log still shows WHY
    // the plain fetch also failed (forbidden host vs 403 vs too-short page).
    firecrawlError.cause = fallbackError
    throw firecrawlError
  }
}

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

export type GeminiFetcher = (url: string, init?: RequestInit) => Promise<Response>

// Real Gemini draft client. Same key-in-header / never-log posture as
// createGeminiChatComplete: the key goes ONLY in x-goog-api-key, never the URL,
// a log, an error, or the returned text.
export function createGeminiDraftComplete(
  apiKey: string | undefined = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get('GEMINI_API_KEY'),
  fetcher: GeminiFetcher = fetch,
): DraftCompleteFn {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set; cannot build the concierge draft LLM client')
  }
  return async (system: string, pageText: string): Promise<string> => {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: pageText }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024, responseMimeType: 'application/json' },
      }),
    }
    // Retry transient Gemini failures (rate-limit / overload / network blip).
    const res = await geminiFetchWithRetry(fetcher, GEMINI_API_URL, init)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(data.error?.message ?? `Gemini API request failed (status ${res.status})`)
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    return (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => typeof p.text === 'string')
      .map((p) => p.text)
      .join('')
  }
}
