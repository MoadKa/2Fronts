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
// THE ONE EXCEPTION, and it is earned, not assumed: when the caller hands over a
// FollowUpGrant (_shared/followUpGrant.ts), a follow-up mail really is coming,
// and the flat prohibition becomes its own kind of lie -- the visitor ticked a
// box, confirmed a mail, and the bot pretends nothing will happen. A grant
// cannot be forged (module-private symbol brand) and is only issued when every
// precondition the SENDER checks is already true. No grant, no mention: the
// no-grant prompt is byte-identical to the one that shipped before any of this
// existed, and a test pins it character for character.
//
// The LLM call is an injectable dep (`complete`) -- like columnMapping's -- so
// tests pin it with canned replies and run with no network. The real Gemini
// implementation is at the bottom and reuses the exact key-in-header / never-log
// / error-handling posture of createGeminiComplete.

import { geminiFetchWithRetry } from './geminiRetry.ts'
import type { ConsentState } from './consent.ts'
import { type FollowUpGrant, isFollowUpGrant } from './followUpGrant.ts'
import type { QualCriterion, QualOption, QualPrompt } from './qualification.ts'

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
  // The qualification question that should be asked on this turn (if any). The
  // model weaves it into its reply so the bot itself asks it — the buttons are
  // just the answer options. Null/absent = nothing to ask this turn.
  pendingCriterion?: QualCriterion | null
  // Whether this visitor's follow-up mail is real (a grant), and whether a
  // promise already made has to be taken back. Absent = the flat prohibition,
  // which is the shipped behaviour and stays the default.
  followUp?: FollowUpPromptState | null
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

// ---------------------------------------------------------------------------
// Follow-up: the three prompt states
// ---------------------------------------------------------------------------

// What the caller knows about this conversation's follow-up situation.
//
// Passing nothing (or an empty object) is the default and produces the prompt
// that shipped before follow-up existed, byte for byte.
export interface FollowUpPromptState {
  // Issued by resolveFollowUpGrant(). Unforgeable: an object literal typed into
  // this field does not compile, and one smuggled in through `as`/JSON fails the
  // runtime brand check below and is treated as no grant at all.
  grant?: FollowUpGrant | null
  // concierge_conversations.followup_promised_at (migration 20260813100000):
  // when the bot first told THIS visitor a mail was coming. Null = it never did.
  promisedAt?: string | null
  // The consent state as it stands right now, derived from the ledger.
  consentState?: ConsentState
}

// THE SENTENCE THAT MAY BE SAID, and the only one.
//
// A single constant on a single array element, deliberately. buildConciergeSystemPrompt
// joins its parts with '\n', so a phrase split across two ELEMENTS would have a
// newline injected into its middle and would be literally ABSENT from the prompt
// that a test then searches for -- the test would fail, or worse, a laxer test
// would pass while the model read two half-sentences.
//
// The line breaks below are INSIDE the constant, so the searched-for string
// contains them and the property still holds exactly. That is the only way to
// wrap this to the same width as the rest of the prompt. Do NOT turn these
// concatenated pieces into separate array elements, and do not reflow them
// without keeping them inside this one constant.
export const FOLLOW_UP_PHRASE =
  '- ONE follow-up email will be sent to the address this visitor already\n' +
  '  confirmed, so you MAY say that an email about this conversation is coming.\n' +
  '  Never say when it will arrive, and never promise anything in it beyond the\n' +
  '  booking link above.'

// State 1 (default): the flat prohibition. Byte-identical to what shipped before
// any follow-up existed. DO NOT EDIT THESE FIVE LINES -- conciergeChat.test.ts
// pins the whole no-grant prompt against a frozen snapshot, because "the bot
// promises nothing" is the property that was true on every page this product has
// ever served, and the migration to sometimes-promising must not quietly change
// what it says when it is NOT promising.
function noPromiseBlock(c: ConciergeKnowledge): string[] {
  return [
    "- NEVER promise anything the system cannot do. You CANNOT notify anyone, you",
    `  CANNOT let ${c.business_name} know, you CANNOT have someone follow up, reach`,
    '  out, call back, or get back to the visitor, and you CANNOT collect contact',
    '  details for follow-up. Do not imply any of these. The ONLY real next step',
    '  you can offer is booking the call via the link above.',
  ]
}

// State 2: a grant is in hand, so the mail is real and may be mentioned.
//
// The contact-details clause SURVIVES, and that is not tidiness. The one lawful
// capture point is the deterministic contact form, which is what renders the
// consent notice and files the evidence row. A model that may "collect contact
// details" harvests addresses in free text, outside the consent surface, with no
// notice shown and nothing to prove -- which is the §7 Abs. 2 UWG failure the
// whole consent chain exists to prevent. Permission to MENTION the mail is not
// permission to ASK for an address.
function grantedBlock(c: ConciergeKnowledge): string[] {
  return [
    FOLLOW_UP_PHRASE,
    '- Nothing else about follow-up became possible. You CANNOT notify anyone, you',
    `  CANNOT let ${c.business_name} know, you CANNOT have someone call back or reach`,
    '  out personally, and you CANNOT ask for or collect contact details — the form on',
    '  this page is the only place an address may ever be given, and that one email is',
    '  the only message that will ever be sent. The real next step you offer is still',
    '  booking the call via the link above.',
  ]
}

// State 3: the bot already promised, and the permission is gone.
//
// This block is ADDED TO the prohibition, never instead of it. The model is not
// starting fresh: its own earlier promise is sitting in the conversation history
// it is about to re-read, and a model reading "an email is on its way" in its
// own voice will happily keep the story going. Silence here reads to the visitor
// as a mail that is still coming. So the correction has to be an instruction,
// and it has to be explicit about going FIRST.
function correctionBlock(c: ConciergeKnowledge): string[] {
  return [
    '- CORRECTION REQUIRED, before anything else you say. Earlier in this conversation',
    '  you told the visitor that an email would follow. That is no longer true: they',
    '  have withdrawn their permission to be emailed, and no email will be sent.',
    `  Open your next reply by saying exactly that, in ${languageName(c.language)}, in one`,
    '  short friendly sentence — no blame, no explanation of why, and do NOT ask them',
    '  to give permission again. Then carry on normally with the booking link above.',
  ]
}

type FollowUpMode = 'none' | 'granted' | 'correction'

// Which of the three states applies.
//
// The correction fires ONLY on a withdrawal, not on any other way a grant can be
// lost. That is deliberate: a withdrawal is the one case where the dispatcher
// CANCELS outright (decide.ts rule 4), so "no email will be sent" is certainly
// true. The other losses -- the coach pausing, an entitlement lapsing -- make
// decide.ts DEFER, and a mail that is merely delayed may still arrive. Retracting
// a promise that then gets kept would be a second false statement, aimed the
// other way, so those stay silent.
function followUpMode(state?: FollowUpPromptState | null): FollowUpMode {
  if (!state) return 'none'
  // Runtime brand check, not a truthiness check: a forged literal that reached
  // here through `as` or JSON.parse must not unlock the mention.
  if (isFollowUpGrant(state.grant)) return 'granted'
  if (state.promisedAt && state.consentState === 'withdrawn') return 'correction'
  return 'none'
}

// Build the system prompt that grounds the AI in this coach's content and pins
// its behaviour. Everything the AI is allowed to say comes from offer + qa; the
// rest of the prompt is guardrails (never invent, honestly route to the booking
// link when it can't answer -- never a fake follow-up unless a grant proves one
// is real, surface booking).
export function buildConciergeSystemPrompt(
  c: ConciergeKnowledge,
  pendingCriterion?: QualCriterion | null,
  followUp?: FollowUpPromptState | null,
): string {
  const mode = followUpMode(followUp)
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
    ...(mode === 'granted' ? grantedBlock(c) : noPromiseBlock(c)),
    ...(mode === 'correction' ? correctionBlock(c) : []),
    '- When the visitor wants to book, is ready, or asks how to get started, share',
    `  the booking link verbatim: ${c.calendar_url}`,
    '- Keep replies short, warm, and conversational. One idea at a time.',
    '- TAKE INITIATIVE — you lead, you do not just wait. Briefly address what the',
    '  visitor said, then move things forward with ONE next step: a guiding question,',
    '  or (when they are ready or it fits) the booking link above. Never end flat or',
    '  passive, and never just ask "what would you like to know?".',
    '- Write PLAIN PROSE. The chat bubble shows your reply verbatim and renders no',
    '  formatting, so Markdown does not become bold or a list — it reaches the',
    '  visitor as literal characters. Never use **, *, _, `, #, or "-" and "1." as',
    '  bullets. If you need to name several things, put them in a sentence or',
    '  across short sentences. This is also why replies stay to one idea at a',
    '  time: a chat message that needs a bulleted list is too long for a chat.',
    ...(pendingCriterion
      ? [
          '- IMPORTANT: ask the visitor this ONE qualifying question on this turn. After',
          '  a short, natural lead-in, ask it in your own words (one question, in',
          `  ${languageName(c.language)}), matching the intent of: "${pendingCriterion.question}"`,
          '  Then STOP. The visitor answers by tapping buttons shown under your message,',
          '  so do NOT list or mention the answer options, and do NOT ask anything else.',
        ]
      : []),
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
  const system = buildConciergeSystemPrompt(
    input.concierge,
    input.pendingCriterion,
    input.followUp,
  )
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
// Free-text qualification classifier (v1.3). When a qualification question is
// pending and the visitor TYPES instead of tapping a button, we let the LLM
// interpret what they wrote against that criterion's options. It returns one of:
//   - the verbatim label of a matching option (visitor answered with an option)
//   - 'OTHER'  -> the visitor answered, but off-menu (not one of the options)
//   - 'NONE'   -> the message is NOT an answer (e.g. a real question back)
// The handler then records an answer (or not) and advances accordingly.

export type ClassifyResult =
  | { kind: 'matched'; option: QualOption }
  | { kind: 'other' }
  | { kind: 'none' }

// Interpret a free-text message against a single criterion. Injectable so the
// handler is unit-tested offline; the default delegates to the Gemini `complete`.
export type ClassifyAnswerFn = (
  criterion: QualCriterion,
  message: string,
) => Promise<ClassifyResult>

// Build the tiny classification system prompt: ask the model to map the visitor's
// message onto exactly ONE option label, or OTHER (answered off-menu), or NONE
// (not an answer at all). Reply must be exactly one token/line so parsing is cheap.
function buildClassifierPrompt(criterion: QualCriterion): string {
  const optionLines = criterion.options.map((o) => `- ${o.label}`).join('\n')
  return [
    'You are a strict classifier. A visitor was asked this qualifying question:',
    `"${criterion.question}"`,
    'The available answer options are:',
    optionLines,
    '',
    'Classify the visitor\'s message into EXACTLY ONE of:',
    '- the exact text of the single option it best matches (copy it verbatim), OR',
    '- OTHER  (the message IS an answer to the question, but does not match any option), OR',
    '- NONE   (the message is NOT an answer — e.g. it is a question, a greeting, or off-topic).',
    '',
    'Reply with ONLY the option text, or OTHER, or NONE. No punctuation, no explanation.',
  ].join('\n')
}

// Default classifier: one short Gemini call, no conversation history. Maps the
// model's single-token reply back to a matched option / OTHER / NONE. Anything
// unexpected is treated as NONE (safest: leaves the criterion pending, never
// records a phantom answer).
export function createClassifyAnswer(complete: ChatCompleteFn): ClassifyAnswerFn {
  return async (criterion: QualCriterion, message: string): Promise<ClassifyResult> => {
    const system = buildClassifierPrompt(criterion)
    const raw = (await complete(system, [{ role: 'user', content: message }])).trim()
    if (raw === '') return { kind: 'none' }
    const upper = raw.toUpperCase()
    if (upper === 'NONE') return { kind: 'none' }
    if (upper === 'OTHER') return { kind: 'other' }
    // Match an option by exact (case-insensitive) label first, then by a tolerant
    // contains check so minor model formatting (quotes, trailing words) still maps.
    const exact = criterion.options.find((o) => o.label.toLowerCase() === raw.toLowerCase())
    if (exact) return { kind: 'matched', option: exact }
    const contained = criterion.options.find(
      (o) => raw.toLowerCase().includes(o.label.toLowerCase()),
    )
    if (contained) return { kind: 'matched', option: contained }
    // The model said something we can't map to an option or to OTHER/NONE.
    // Treat as not-an-answer so we never fabricate a qualification record.
    return { kind: 'none' }
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
        // thinkingBudget 0: Gemini 2.5 reasons by default and bills those tokens
        // against maxOutputTokens. The concierge draft path hit exactly that and
        // returned answers cut off mid-sentence; here it would truncate a reply
        // to a visitor. The bot answers from the coach's own text, so it has
        // nothing to reason its way to.
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
        },
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
