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

// Fetch the readable text of a page. Injectable; the default uses Firecrawl
// (renders JS + gets past bot-blocking), but tests pass canned page text.
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

// Scrape a page's readable text via Firecrawl. A plain fetch can't read modern
// coach sites: site builders (Wix/Squarespace/Framer) render the page in the
// browser, so the raw HTML is an empty shell, and Cloudflare/bot-protection
// blocks a non-browser request outright — both leave the draft empty. Firecrawl
// renders JS and gets past the blocks, returning clean markdown to ground the
// draft (the coach still edits it). Injectable fetcher keeps tests offline. The
// key goes ONLY in the Authorization header, never the URL/a log/an error.
// Requires FIRECRAWL_API_KEY; without it (or on any Firecrawl failure) we throw,
// the edge fn maps it to a 502, and the wizard falls back to manual entry.
export async function defaultScrape(
  url: string,
  fetcher: typeof fetch = fetch,
  apiKey: string | undefined = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get('FIRECRAWL_API_KEY'),
): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('invalid_url')
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set; cannot scrape the page')
  const res = await fetcher(FIRECRAWL_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
  })
  if (!res.ok) throw new Error(`scrape_failed_${res.status}`)
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { markdown?: string } }
  const markdown = data?.data?.markdown ?? ''
  if (!data?.success || !markdown.trim()) throw new Error('scrape_empty')
  return markdown
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
    const res = await fetcher(GEMINI_API_URL, {
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
    })
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
