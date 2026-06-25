// The concierge brain -- a MULTI-TURN variant of the column-mapping Gemini
// client (columnMapping.ts). Where that client answers one strict-JSON question
// with no history, this one carries a whole conversation: a system prompt built
// from the coach's offer/qa/tone/language plus the turns so far.
//
// TRUST CORE (mirrors the F3 guardrail in columnMapping.ts:9-16): the AI answers
// ONLY from the coach's offer/qa. It must NEVER invent prices, policies, or
// dates. When it can't answer from the provided content it must NOT invent an
// answer AND must NOT promise any follow-up -- there is no mechanism here that
// notifies the coach or calls anyone back, so promising one would be a lie. The
// only real next step the system can offer is the booking link, so the honest
// fallback is "I can't answer that one here -- get it answered on a quick call:
// {calendar_url}". A confidently-wrong answer (or a promise the system can't
// keep) to a coach's prospect is trust-destroying, so "route to the booking
// link, promise nothing the system can't do" beats "guess" or "fake a callback".
//
// The LLM call is an injectable dep (`complete`) -- like columnMapping's -- so
// tests pin it with canned replies and run with no network. The real Gemini
// implementation is at the bottom and reuses the exact key-in-header / never-log
// / error-handling posture of createGeminiComplete.

import { geminiFetchWithRetry } from './geminiRetry.ts'
import type { QualCriterion, QualPrompt } from './qualification.ts'

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
  // The coach's ideal-customer criteria. The handler (not the LLM) deterministically
  // asks these as quick-reply buttons; empty = no qualification. (Shared contract.)
  qualification_criteria: QualCriterion[]
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
  // The next qualification question to render as quick-reply buttons. Set by the
  // handler (deterministic), never by the LLM. Absent when nothing left to ask.
  quick_replies?: QualPrompt
}

function languageName(language: ConciergeLanguage): string {
  return language === 'en' ? 'English' : 'German'
}

// Graceful, honest fallback for when the model returns nothing usable (Gemini can
// emit an empty/SAFETY-blocked response -> empty string -> a blank bubble to the
// visitor). Same spirit as the prompt's honest-handoff rule: admit we can't
// answer that one here and point to the only real next step -- the booking link.
// Promises nothing the system can't keep (no follow-up, no callback).
function emptyReplyFallback(c: ConciergeKnowledge): string {
  if (c.calendar_url && c.calendar_url.trim() !== '') {
    return c.language === 'en'
      ? `Sorry, I can't answer that one here. The quickest way to get it answered is a short call — you can book one here: ${c.calendar_url}`
      : `Entschuldige, das kann ich hier nicht beantworten. Am schnellsten klärst du das in einem kurzen Gespräch — hier kannst du einen Termin buchen: ${c.calendar_url}`
  }
  return c.language === 'en'
    ? "Sorry, I can't answer that one here."
    : 'Entschuldige, das kann ich hier nicht beantworten.'
}

// Build the system prompt that grounds the AI in this coach's content and pins
// its behaviour. Everything the AI is allowed to say comes from offer + qa; the
// rest of the prompt is guardrails (never invent, honestly route to the booking
// link when it can't answer -- never a fake follow-up, surface booking).
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
    `- If you cannot answer from the content above, do NOT make something up. Say`,
    `  honestly (in ${languageName(c.language)}) that you can't answer that specific`,
    '  thing here, and invite the visitor to get it answered on a quick call by',
    `  sharing the booking link verbatim: ${c.calendar_url}`,
    "- NEVER promise anything the system cannot do. You CANNOT notify anyone, you",
    `  CANNOT let ${c.business_name} know, you CANNOT have someone follow up, reach`,
    '  out, call back, or get back to the visitor, and you CANNOT collect contact',
    '  details for follow-up. Do not imply any of these. The ONLY real next step',
    '  you can offer is booking the call via the link above.',
    '- When the visitor wants to book, is ready, or asks how to get started, share',
    `  the booking link verbatim: ${c.calendar_url}`,
    '- Keep replies short, warm, and conversational. One idea at a time.',
    '- Another part of the system asks the visitor any qualifying questions via',
    '  quick-reply buttons, so do NOT ask qualifying questions yourself.',
  ].join('\n')
}

// show_booking is true when the reply actually contains the booking link, so the
// page only renders the CTA when the AI decided to offer it. An empty calendar
// url can never trigger booking (guards a misconfigured concierge). The URL must
// be followed by a word boundary (end of string, whitespace, or one of ) ] . , !
// ?) so a configured url that is a strict prefix of a longer url in the reply
// (e.g. .../intro vs .../intro-vip) does not falsely trigger booking.
export function detectShowBooking(reply: string, calendarUrl: string): boolean {
  if (!calendarUrl || calendarUrl.trim() === '') return false
  const escaped = calendarUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}(?=$|[\\s)\\].,!?])`).test(reply)
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

  // An empty/whitespace-only reply (e.g. a SAFETY-blocked Gemini response) would
  // render as a blank bubble. Substitute the honest localized fallback, and --
  // since that fallback itself offers the booking link -- surface booking when a
  // calendar url is configured so the visitor still has a real path forward.
  if (reply.trim() === '') {
    const hasCalendar =
      !!input.concierge.calendar_url && input.concierge.calendar_url.trim() !== ''
    return {
      reply: emptyReplyFallback(input.concierge),
      show_booking: hasCalendar,
      calendar_url: hasCalendar ? input.concierge.calendar_url : undefined,
    }
  }

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
    const init: RequestInit = {
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
    }

    // Retry transient Gemini failures (rate-limit / overload / network blip)
    // before surfacing an error to the visitor mid-conversation.
    const res = await geminiFetchWithRetry(fetcher, GEMINI_API_URL, init)

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
