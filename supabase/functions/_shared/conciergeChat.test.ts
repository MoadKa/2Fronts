import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  buildConciergeSystemPrompt,
  type ChatCompleteFn,
  type ChatTurn,
  createGeminiChatComplete,
  detectShowBooking,
  generateConciergeReply,
} from './conciergeChat.ts'

const concierge = {
  business_name: 'Acme Coaching',
  offer_description: 'A 12-week 1:1 program for founders, EUR 5000.',
  qa: 'Q: Refunds? A: 14-day money back.',
  tone: 'friendly',
  language: 'de' as const,
  calendar_url: 'https://cal.com/acme/intro',
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
  // The trust core: never invent, fall back when unsure.
  assertStringIncludes(prompt.toLowerCase(), 'never')
  assertStringIncludes(prompt, 'Acme Coaching follow up')
})

Deno.test('buildConciergeSystemPrompt says English when language is en', () => {
  const prompt = buildConciergeSystemPrompt({ ...concierge, language: 'en' })
  assertStringIncludes(prompt, 'English')
})

Deno.test('detectShowBooking is true once the calendar url appears in the reply', () => {
  assertEquals(detectShowBooking('Sure! Book here: https://cal.com/acme/intro', concierge.calendar_url), true)
  assertEquals(detectShowBooking('Happy to help with that.', concierge.calendar_url), false)
})

Deno.test('detectShowBooking is false for an empty calendar url', () => {
  assertEquals(detectShowBooking('anything', ''), false)
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
