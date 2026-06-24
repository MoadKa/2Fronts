// The concierge brain -- a MULTI-TURN variant of the column-mapping Gemini
// client (columnMapping.ts). Where that client answers one strict-JSON question
// with no history, this one carries a whole conversation: a system prompt built
// from the coach's offer/qa/tone/language plus the turns so far.
//
// TRUST CORE (mirrors the F3 guardrail in columnMapping.ts:9-16): the AI answers
// ONLY from the coach's offer/qa. It must NEVER invent prices, policies, or
// dates. When it can't answer from the provided content it falls back to
// "I'll have {business_name} follow up", and it surfaces the calendar link on
// booking intent. A confidently-wrong answer to a coach's prospect is
// trust-destroying, so "fall back when unsure" beats "guess".
//
// The LLM call is an injectable dep (`complete`) -- like columnMapping's -- so
// tests pin it with canned replies and run with no network. The real Gemini
// implementation is at the bottom and reuses the exact key-in-header / never-log
// / error-handling posture of createGeminiComplete.

export type ConciergeLanguage = 'de' | 'en'

// The coach's concierge knowledge, as the runtime needs it. (A subset of the
// concierges row; loaded server-side via the admin client and never sent raw to
// the browser.)
export interface ConciergeKnowledge {
  business_name: string
  offer_description: string
  qa: string
  tone: string
  language: ConciergeLanguage
  calendar_url: string
}

// One turn of the conversation. 'assistant' is the AI; 'user' is the visitor.
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

// The one external effect: turn a system prompt + conversation into the model's
// next reply. Injectable so tests are deterministic and offline (mirrors
// columnMapping.ts's CompleteFn, but multi-turn).
export type ChatCompleteFn = (system: string, turns: ChatTurn[]) => Promise<string>

export interface ConciergeChatDeps {
  complete: ChatCompleteFn
}

export interface GenerateConciergeReplyInput {
  concierge: ConciergeKnowledge
  // Prior turns of THIS visitor's conversation, oldest first.
  history: ChatTurn[]
  // The visitor's new message.
  message: string
}

export interface ConciergeReply {
  reply: string
  show_booking: boolean
  // Only set when show_booking is true, so the page never renders a bare CTA.
  calendar_url?: string
}

function languageName(language: ConciergeLanguage): string {
  return language === 'en' ? 'English' : 'German'
}

// Build the system prompt that grounds the AI in this coach's content and pins
// its behaviour. Everything the AI is allowed to say comes from offer + qa; the
// rest of the prompt is guardrails (never invent, fall back, surface booking).
export function buildConciergeSystemPrompt(c: ConciergeKnowledge): string {
  return [
    `You are the AI booking assistant for "${c.business_name}". You chat with`,
    "visitors on the coach's public page, answer their questions, gently handle",
    'hesitation, and help them book a call.',
    '',
    `Speak in a ${c.tone} tone, as ${c.business_name} would.`,
    `ALWAYS respond in ${languageName(c.language)}, regardless of the visitor's language.`,
    '',
    "What the coach offers:",
    c.offer_description,
    '',
    'Questions the coach has already answered (use these as your source of truth):',
    c.qa && c.qa.trim() !== '' ? c.qa : '(none provided)',
    '',
    'STRICT RULES (these protect the coach and are non-negotiable):',
    '- Answer ONLY from the offer and Q&A above. This is your entire knowledge.',
    '- NEVER invent or guess prices, policies, dates, availability, or facts that',
    '  are not stated above. A wrong answer to a prospect destroys trust.',
    `- If you cannot answer from the content above, say (in ${languageName(c.language)})`,
    `  that you'll have ${c.business_name} follow up — do not make something up.`,
    '- When the visitor wants to book, is ready, or asks how to get started, share',
    `  the booking link verbatim: ${c.calendar_url}`,
    '- Keep replies short, warm, and conversational. One idea at a time.',
  ].join('\n')
}

// show_booking is true when the reply actually contains the booking link, so the
// page only renders the CTA when the AI decided to offer it. An empty calendar
// url can never trigger booking (guards a misconfigured concierge).
export function detectShowBooking(reply: string, calendarUrl: string): boolean {
  if (!calendarUrl || calendarUrl.trim() === '') return false
  return reply.includes(calendarUrl)
}

// Generate the concierge's next reply. Builds the grounded system prompt, hands
// the model the full history plus the new user message, and reports whether the
// reply surfaced the booking link (so the caller can flip the conversation
// outcome to 'booking_shown' and the page can render the CTA).
export async function generateConciergeReply(
  input: GenerateConciergeReplyInput,
  deps: ConciergeChatDeps,
): Promise<ConciergeReply> {
  const system = buildConciergeSystemPrompt(input.concierge)
  const turns: ChatTurn[] = [...input.history, { role: 'user', content: input.message }]
  const reply = await deps.complete(system, turns)

  const show_booking = detectShowBooking(reply, input.concierge.calendar_url)
  return {
    reply,
    show_booking,
    calendar_url: show_booking ? input.concierge.calendar_url : undefined,
  }
}

// ---------------------------------------------------------------------------
// Default real implementation of `complete`, calling the Google Gemini API via
// fetch -- the multi-turn sibling of createGeminiComplete in columnMapping.ts.
// Same model, same key-in-header posture: the key is read once and placed ONLY
// in the x-goog-api-key header, NEVER in the URL (logged), a log line, an error
// message, or the returned text. A small temperature keeps the concierge warm
// but on-topic.

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

export type GeminiFetcher = (url: string, init?: RequestInit) => Promise<Response>

// Map our ChatTurn[] to Gemini's contents[]: user -> 'user', assistant ->
// 'model'. The system prompt goes in the dedicated system_instruction block so
// the guardrails are not just another turn the model can drift from.
function toGeminiContents(turns: ChatTurn[]) {
  return turns.map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.content }],
  }))
}

export function createGeminiChatComplete(
  apiKey: string | undefined = Deno.env.get('GEMINI_API_KEY'),
  fetcher: GeminiFetcher = fetch,
): ChatCompleteFn {
  if (!apiKey) {
    // Fail clearly and early -- but say nothing about the key's value.
    throw new Error(
      'GEMINI_API_KEY is not set; cannot build the concierge chat LLM client',
    )
  }

  return async (system: string, turns: ChatTurn[]): Promise<string> => {
    const res = await fetcher(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        // Header auth keeps the key out of the URL (URLs get logged; headers don't).
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: toGeminiContents(turns),
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      }),
    })

    if (!res.ok) {
      // Surface the API's error message, but never the request we sent (which
      // carries the key in its headers).
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new Error(data.error?.message ?? `Gemini API request failed (status ${res.status})`)
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => typeof p.text === 'string')
      .map((p) => p.text)
      .join('')
    return text
  }
}
