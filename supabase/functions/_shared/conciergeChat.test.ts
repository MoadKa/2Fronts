import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  buildConciergeSystemPrompt,
  type ChatCompleteFn,
  type ChatTurn,
  createClassifyAnswer,
  createGeminiChatComplete,
  detectShowBooking,
  generateConciergeReply,
} from './conciergeChat.ts'
import type { QualCriterion } from './qualification.ts'

const concierge = {
  business_name: 'Acme Coaching',
  offer_description: 'A 12-week 1:1 program for founders, EUR 5000.',
  qa: 'Q: Refunds? A: 14-day money back.',
  tone: 'friendly',
  language: 'de' as const,
  calendar_url: 'https://cal.com/acme/intro',
  qualification_criteria: [],
}

// A chat complete() that returns the same canned text regardless of input.
function cannedChat(text: string): ChatCompleteFn {
  return () => Promise.resolve(text)
}

Deno.test('buildConciergeSystemPrompt grounds the AI in the offer + qa and pins the language', () => {
  const prompt = buildConciergeSystemPrompt(concierge)
  assertStringIncludes(prompt, 'Acme Coaching')
  assertStringIncludes(prompt, '12-week 1:1 program')
  assertStringIncludes(prompt, '14-day money back')
  // Language must be pinned to the concierge's chosen language.
  assertStringIncludes(prompt, 'German')
  // The trust core: never invent, route honestly to the booking link when unsure.
  assertStringIncludes(prompt.toLowerCase(), 'never')
  // The honest-handoff fallback points to the booking link, not a fake follow-up.
  assertStringIncludes(prompt, concierge.calendar_url)
})

Deno.test('buildConciergeSystemPrompt makes NO follow-up/notify promise and forbids fake follow-ups', () => {
  const prompt = buildConciergeSystemPrompt(concierge)
  const lower = prompt.toLowerCase()
  // The old false promise ("I'll have {business_name} follow up") must be gone.
  assertEquals(lower.includes('follow up'), true) // present only as a FORBIDDEN action
  assertEquals(lower.includes(`have ${concierge.business_name.toLowerCase()} follow up`), false)
  assertEquals(lower.includes(`${concierge.business_name.toLowerCase()} follow up`), false)
  // And the explicit no-false-promise rule must be present.
  assertStringIncludes(prompt, 'NEVER promise anything the system cannot do')
  assertStringIncludes(lower, 'cannot notify')
})

Deno.test('buildConciergeSystemPrompt says English when language is en', () => {
  const prompt = buildConciergeSystemPrompt({ ...concierge, language: 'en' })
  assertStringIncludes(prompt, 'English')
})

Deno.test('buildConciergeSystemPrompt always tells the bot to take initiative', () => {
  assertStringIncludes(buildConciergeSystemPrompt(concierge), 'INITIATIVE')
})

Deno.test('buildConciergeSystemPrompt makes the bot ASK the pending qualifying question itself', () => {
  const prompt = buildConciergeSystemPrompt(concierge, {
    id: 'budget',
    question: 'What is your budget?',
    options: [{ label: '5k+', qualifies: true }],
  })
  // The bot is told to ask the question (so the reply leads into the buttons),
  // and explicitly NOT to list the options (the buttons show them).
  assertStringIncludes(prompt, 'What is your budget?')
  assertStringIncludes(prompt, 'do NOT list or mention the answer options')
  // Without a pending criterion, no such question is injected.
  assertEquals(buildConciergeSystemPrompt(concierge).includes('What is your budget?'), false)
})

Deno.test('detectShowBooking is true once the calendar url appears in the reply', () => {
  assertEquals(detectShowBooking('Sure! Book here: https://cal.com/acme/intro', concierge.calendar_url), true)
  assertEquals(detectShowBooking('Happy to help with that.', concierge.calendar_url), false)
})

Deno.test('detectShowBooking is false for an empty calendar url', () => {
  assertEquals(detectShowBooking('anything', ''), false)
})

Deno.test('detectShowBooking matches only on a word boundary after the url', () => {
  const url = concierge.calendar_url
  // True when the url is followed by end-of-string, whitespace, or punctuation.
  assertEquals(detectShowBooking(url, url), true)
  assertEquals(detectShowBooking(`Book here: ${url} — see you soon`, url), true)
  assertEquals(detectShowBooking(`Book here: ${url}.`, url), true)
  assertEquals(detectShowBooking(`Book here: ${url}!`, url), true)
  assertEquals(detectShowBooking(`(${url})`, url), true)
  // False when the configured url is a strict PREFIX of a longer url in the reply.
  assertEquals(detectShowBooking(`Book the VIP slot: ${url}-vip`, url), false)
  assertEquals(detectShowBooking(`${url}/extra`, url), false)
})

Deno.test('generateConciergeReply returns the model reply and detects booking when the link surfaces', async () => {
  const complete = cannedChat('Klar, hier kannst du buchen: https://cal.com/acme/intro')
  const result = await generateConciergeReply(
    { concierge, history: [], message: 'Ich will einen Termin' },
    { complete },
  )
  assertEquals(result.reply, 'Klar, hier kannst du buchen: https://cal.com/acme/intro')
  assertEquals(result.show_booking, true)
  assertEquals(result.calendar_url, concierge.calendar_url)
})

Deno.test('generateConciergeReply does NOT surface booking for an ordinary answer', async () => {
  const complete = cannedChat('Das Programm dauert 12 Wochen.')
  const result = await generateConciergeReply(
    { concierge, history: [], message: 'Wie lange dauert das Programm?' },
    { complete },
  )
  assertEquals(result.show_booking, false)
  assertEquals(result.calendar_url, undefined)
})

Deno.test('generateConciergeReply substitutes a localized booking fallback for an empty model reply', async () => {
  // Gemini can return an empty/SAFETY-blocked string; the visitor must not get a blank bubble.
  const complete = cannedChat('')
  const result = await generateConciergeReply(
    { concierge, history: [], message: 'Etwas heikles' },
    { complete },
  )
  assertEquals(result.reply.trim() !== '', true)
  // German fallback (concierge.language === 'de') that points to the booking link.
  assertStringIncludes(result.reply, 'Entschuldige')
  assertStringIncludes(result.reply, concierge.calendar_url)
  assertEquals(result.show_booking, true)
  assertEquals(result.calendar_url, concierge.calendar_url)
})

Deno.test('generateConciergeReply empty-reply fallback uses English and respects an unset calendar url', async () => {
  const complete = cannedChat('   ') // whitespace-only counts as empty
  const result = await generateConciergeReply(
    { concierge: { ...concierge, language: 'en', calendar_url: '' }, history: [], message: 'x' },
    { complete },
  )
  assertEquals(result.reply.trim() !== '', true)
  assertStringIncludes(result.reply, 'Sorry')
  // No calendar url configured -> no CTA path to offer.
  assertEquals(result.show_booking, false)
  assertEquals(result.calendar_url, undefined)
})

Deno.test('generateConciergeReply passes the full multi-turn history to complete()', async () => {
  let received: { system: string; turns: ChatTurn[] } | null = null
  const complete: ChatCompleteFn = (system, turns) => {
    received = { system, turns }
    return Promise.resolve('ok')
  }
  const history: ChatTurn[] = [
    { role: 'user', content: 'Hallo' },
    { role: 'assistant', content: 'Hallo! Wie kann ich helfen?' },
  ]
  await generateConciergeReply({ concierge, history, message: 'Was kostet es?' }, { complete })

  // The system prompt + prior turns + the new user message all reach the model.
  assertStringIncludes(received!.system, 'Acme Coaching')
  assertEquals(received!.turns.length, 3)
  assertEquals(received!.turns[0], { role: 'user', content: 'Hallo' })
  assertEquals(received!.turns[2], { role: 'user', content: 'Was kostet es?' })
})

// --- Free-text qualification classifier (v1.3) -------------------------------

const budget: QualCriterion = {
  id: 'budget',
  question: 'What is your budget?',
  options: [
    { label: '5k+', qualifies: true },
    { label: '<1k', qualifies: false },
  ],
}

Deno.test('createClassifyAnswer maps an exact option label (case-insensitive) to a matched option', async () => {
  const classify = createClassifyAnswer(cannedChat('5K+'))
  const r = await classify(budget, 'we can do 5k+')
  assertEquals(r.kind, 'matched')
  if (r.kind === 'matched') assertEquals(r.option.label, '5k+')
})

Deno.test('createClassifyAnswer maps a contained option label even with extra model text', async () => {
  const classify = createClassifyAnswer(cannedChat('The answer is "<1k"'))
  const r = await classify(budget, 'tiny budget')
  assertEquals(r.kind, 'matched')
  if (r.kind === 'matched') assertEquals(r.option.label, '<1k')
})

Deno.test('createClassifyAnswer returns OTHER and NONE verbatim, and treats unmappable output as NONE', async () => {
  assertEquals((await createClassifyAnswer(cannedChat('OTHER'))(budget, 'depends')).kind, 'other')
  assertEquals((await createClassifyAnswer(cannedChat('NONE'))(budget, 'what is included?')).kind, 'none')
  // Empty or unrecognizable model output is safest as NONE (never fabricate an answer).
  assertEquals((await createClassifyAnswer(cannedChat(''))(budget, 'x')).kind, 'none')
  assertEquals((await createClassifyAnswer(cannedChat('banana'))(budget, 'x')).kind, 'none')
})

Deno.test('createGeminiChatComplete throws a clear error when the API key is missing (never prints it)', () => {
  let threw: Error | null = null
  try {
    createGeminiChatComplete(undefined, () => Promise.resolve(new Response('{}')))
  } catch (e) {
    threw = e as Error
  }
  assertEquals(threw !== null, true)
  assertStringIncludes(threw!.message, 'GEMINI_API_KEY')
})

Deno.test('createGeminiChatComplete sends the key as a header (not URL or body) and maps roles', async () => {
  let sentApiKey = ''
  let sentUrl = ''
  let sentBody = ''
  const fetcher = (url: string, init?: RequestInit) => {
    sentUrl = url
    sentApiKey = new Headers(init?.headers).get('x-goog-api-key') ?? ''
    sentBody = init?.body?.toString() ?? ''
    return Promise.resolve(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hello there' }] } }] }),
        { status: 200 },
      ),
    )
  }
  const complete = createGeminiChatComplete('secret-key-123', fetcher)
  const text = await complete('You are a concierge.', [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello' },
    { role: 'user', content: 'Price?' },
  ])

  assertEquals(text, 'hello there')
  assertEquals(sentApiKey, 'secret-key-123')
  assertEquals(sentUrl.includes('secret-key-123'), false)
  assertEquals(sentBody.includes('secret-key-123'), false)
  // Gemini uses 'model' for the assistant role and a system_instruction block.
  assertStringIncludes(sentBody, '"model"')
  assertStringIncludes(sentBody, 'system_instruction')
})

Deno.test('createGeminiChatComplete surfaces the API error message on failure', async () => {
  const fetcher = () =>
    Promise.resolve(new Response(JSON.stringify({ error: { message: 'RESOURCE_EXHAUSTED' } }), { status: 429 }))
  const complete = createGeminiChatComplete('secret-key-123', fetcher)
  await assertRejects(() => complete('sys', [{ role: 'user', content: 'x' }]), Error, 'RESOURCE_EXHAUSTED')
})

Deno.test('createGeminiChatComplete retries a transient 503 and then succeeds (no hard error to the visitor)', async () => {
  let calls = 0
  const fetcher = () => {
    calls++
    if (calls < 3) return Promise.resolve(new Response('{}', { status: 503 }))
    return Promise.resolve(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'recovered' }] } }] }), { status: 200 }),
    )
  }
  const text = await createGeminiChatComplete('k', fetcher)('sys', [{ role: 'user', content: 'x' }])
  assertEquals(text, 'recovered')
  assertEquals(calls, 3)
})

Deno.test('createGeminiChatComplete retries a network-layer failure and then succeeds', async () => {
  let calls = 0
  const fetcher = () => {
    calls++
    if (calls === 1) return Promise.reject(new Error('network down'))
    return Promise.resolve(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 }),
    )
  }
  const text = await createGeminiChatComplete('k', fetcher)('sys', [{ role: 'user', content: 'x' }])
  assertEquals(text, 'ok')
  assertEquals(calls, 2)
})

Deno.test('createGeminiChatComplete does NOT retry a non-retryable 400 (fails fast)', async () => {
  let calls = 0
  const fetcher = () => {
    calls++
    return Promise.resolve(new Response(JSON.stringify({ error: { message: 'INVALID_ARGUMENT' } }), { status: 400 }))
  }
  await assertRejects(
    () => createGeminiChatComplete('k', fetcher)('sys', [{ role: 'user', content: 'x' }]),
    Error,
    'INVALID_ARGUMENT',
  )
  assertEquals(calls, 1)
})

Deno.test('createGeminiChatComplete disables thinking so the reply gets the whole token budget', async () => {
  // Same regression as the concierge draft path: Gemini 2.5 reasons by default
  // and bills those tokens against maxOutputTokens. There it truncated the JSON
  // mid-string; here it would cut off a reply to a visitor mid-sentence. The
  // bot answers from the coach's own text, so it has nothing to reason toward.
  let body: Record<string, unknown> = {}
  const fetcher = ((_u: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Promise.resolve(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 }),
    )
  }) as typeof fetch

  await createGeminiChatComplete('k', fetcher)('sys', [{ role: 'user', content: 'hi' }])

  const cfg = body.generationConfig as Record<string, unknown>
  const thinking = cfg.thinkingConfig as Record<string, unknown>
  assertEquals(thinking.thinkingBudget, 0)
})

// The chat bubble renders replies as plain text (ConciergePublicPage.tsx:271 is
// `{m.content}`), and nothing in this prompt used to say anything about output
// format. So the model reached for its default -- Markdown -- and a real demo
// screenshot showed a prospect the literal characters:
//
//   * **BRAIN KICKS WEEKLY:** Ein 12-Wochen-Audio-Training...
//
// Rendering Markdown instead was the alternative, and it was rejected: it means
// turning model output into HTML on a public, no-login page, which is real
// attack surface for a cosmetic gain.
//
// This asserts we ASK for plain prose. It cannot assert the model complies --
// that needs a live call, which these tests deliberately do not make. Its value
// is as a guard: if someone trims this rule out of the prompt, the raw
// asterisks come back and nobody would notice until a prospect saw them.
Deno.test('buildConciergeSystemPrompt forbids Markdown, because the chat renders text verbatim', () => {
  const prompt = buildConciergeSystemPrompt(concierge)
  assertStringIncludes(prompt, 'Markdown')
  // Named literally so the instruction cannot be satisfied by a vague
  // "write nicely" that a model reads as permission to keep formatting.
  assertStringIncludes(prompt, '**')
})
