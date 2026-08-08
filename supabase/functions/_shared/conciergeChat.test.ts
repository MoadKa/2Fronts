import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  buildConciergeSystemPrompt,
  type ChatCompleteFn,
  type ChatTurn,
  createClassifyAnswer,
  createGeminiChatComplete,
  detectShowBooking,
  FOLLOW_UP_PHRASE,
  generateConciergeReply,
} from './conciergeChat.ts'
import {
  type FollowUpGrant,
  type FollowUpGrantInput,
  resolveFollowUpGrant,
} from './followUpGrant.ts'
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

// ---------------------------------------------------------------------------
// Follow-up: the three prompt states
// ---------------------------------------------------------------------------

// THE FROZEN SNAPSHOT. Character for character what buildConciergeSystemPrompt
// produced for `concierge` on the day the follow-up grant was introduced -- i.e.
// before any of it existed.
//
// This is the most important assertion in this file. The setter has told every
// visitor of every coach, on every page this product has ever served, that it
// cannot have anyone follow up. Adding a case where that changes is only
// defensible if the case where it does NOT change is provably untouched. A
// string comparison is the only thing that proves it: any of the softer
// assertions in this file would still pass if a word, an indent or a newline
// moved.
//
// If this test fails, the question is never "update the snapshot". It is "which
// visitor is now being told something different, and did anyone decide that".
const NO_GRANT_PROMPT = `You are the AI booking assistant for "Acme Coaching". You chat with
visitors on the coach's public page, answer their questions, gently handle
hesitation, and help them book a call.

Speak in a friendly tone, as Acme Coaching would.
ALWAYS respond in German, regardless of the visitor's language.

What the coach offers:
A 12-week 1:1 program for founders, EUR 5000.

Questions the coach has already answered (use these as your source of truth):
Q: Refunds? A: 14-day money back.

STRICT RULES (these protect the coach and are non-negotiable):
- Answer ONLY from the offer and Q&A above. This is your entire knowledge.
- NEVER invent or guess prices, policies, dates, availability, or facts that
  are not stated above. A wrong answer to a prospect destroys trust.
- If you cannot answer from the content above, do NOT make something up. Say
  honestly (in German) that you can't answer that specific
  thing here, and invite the visitor to get it answered on a quick call by
  sharing the booking link verbatim: https://cal.com/acme/intro
- NEVER promise anything the system cannot do. You CANNOT notify anyone, you
  CANNOT let Acme Coaching know, you CANNOT have someone follow up, reach
  out, call back, or get back to the visitor, and you CANNOT collect contact
  details for follow-up. Do not imply any of these. The ONLY real next step
  you can offer is booking the call via the link above.
- When the visitor wants to book, is ready, or asks how to get started, share
  the booking link verbatim: https://cal.com/acme/intro
- Keep replies short, warm, and conversational. One idea at a time.
- TAKE INITIATIVE — you lead, you do not just wait. Briefly address what the
  visitor said, then move things forward with ONE next step: a guiding question,
  or (when they are ready or it fits) the booking link above. Never end flat or
  passive, and never just ask "what would you like to know?".
- Write PLAIN PROSE. The chat bubble shows your reply verbatim and renders no
  formatting, so Markdown does not become bold or a list — it reaches the
  visitor as literal characters. Never use **, *, _, \`, #, or "-" and "1." as
  bullets. If you need to name several things, put them in a sentence or
  across short sentences. This is also why replies stay to one idea at a
  time: a chat message that needs a bulleted list is too long for a chat.`

// A real grant. Minted through resolveFollowUpGrant with every precondition
// satisfied, and with the shipped flag forced on (it is false in production, and
// deliberately so) -- because a grant is the ONLY way to reach the granted
// prompt state, and a test cannot fabricate one.
function realGrant(): FollowUpGrant {
  const input: FollowUpGrantInput = {
    concierge: {
      is_active: true,
      is_demo: false,
      entitled_until: '2026-12-01T00:00:00.000Z',
      calendar_url: concierge.calendar_url,
      followup_enabled: true,
      followup_sender_ack_at: '2026-08-01T09:00:00.000Z',
      followup_sender_block: 'Acme Coaching GmbH, Musterstr. 1, 45127 Essen',
      followup_privacy_url: 'https://acme.example/datenschutz',
      followup_reply_to: 'coach@acme.example',
      followup_reply_to_verified_at: '2026-08-02T09:00:00.000Z',
    },
    consentState: 'confirmed',
    consentEmail: 'visitor@example.com',
    consentConfirmedAt: '2026-08-13T10:00:00.000Z',
    visitorEmail: 'visitor@example.com',
    suppressed: false,
    alreadyMailed: false,
    sendingEnabled: true,
    now: new Date('2026-08-13T12:00:00.000Z'),
  }
  const grant = resolveFollowUpGrant(input, true)
  if (!grant) throw new Error('test fixture: expected a grant')
  return grant
}

Deno.test('STATE 1 — with no grant the prompt is BYTE-IDENTICAL to the one that shipped', () => {
  assertEquals(buildConciergeSystemPrompt(concierge), NO_GRANT_PROMPT)
  // Every shape of "no follow-up information" produces the same bytes: omitted,
  // null, an empty state object, and an explicit null grant.
  assertEquals(buildConciergeSystemPrompt(concierge, null), NO_GRANT_PROMPT)
  assertEquals(buildConciergeSystemPrompt(concierge, null, null), NO_GRANT_PROMPT)
  assertEquals(buildConciergeSystemPrompt(concierge, null, {}), NO_GRANT_PROMPT)
  assertEquals(buildConciergeSystemPrompt(concierge, null, { grant: null }), NO_GRANT_PROMPT)
  // And it says nothing about a follow-up mail coming.
  assertEquals(NO_GRANT_PROMPT.includes(FOLLOW_UP_PHRASE), false)
})

Deno.test('STATE 1 — a forged grant object cannot unlock the mention', () => {
  // The compile-time half of this is in followUpGrant.test.ts: the brand is a
  // module-private `unique symbol`, so an object literal typed as FollowUpGrant
  // does not compile anywhere outside that module. This is the runtime half --
  // a forgery that got here through `as`, through JSON.parse, or through an
  // `any`-typed boundary must be treated as no grant at all, not as a grant.
  const forged = { kind: 'follow_up_grant' } as unknown as FollowUpGrant
  assertEquals(buildConciergeSystemPrompt(concierge, null, { grant: forged }), NO_GRANT_PROMPT)
})

Deno.test('STATE 2 — a real grant lets the bot mention the mail, exactly once', () => {
  const prompt = buildConciergeSystemPrompt(concierge, null, { grant: realGrant() })
  assertStringIncludes(prompt, FOLLOW_UP_PHRASE)
  // Exactly once. A phrase that appears twice usually means it was assembled
  // from parts and a refactor duplicated one of them; a phrase that appears
  // zero times means it was split across two array elements and the join()
  // pushed a newline through its middle -- which is invisible to a substring
  // assertion on either half, and is why this counts.
  assertEquals(prompt.split(FOLLOW_UP_PHRASE).length - 1, 1)
  // The prohibition on COLLECTING contact details survives. Permission to
  // mention the mail is not permission to ask for an address: the deterministic
  // contact form is the only lawful capture point, because it is what renders
  // the consent notice and files the evidence row. A model that may harvest
  // addresses in free text collects them outside that surface entirely.
  assertStringIncludes(prompt, 'CANNOT ask for or collect contact details')
  // Everything else the system still cannot do is still refused.
  assertStringIncludes(prompt, 'CANNOT notify anyone')
  assertStringIncludes(prompt, 'CANNOT have someone call back')
  // The granted state is a real change, not a no-op.
  assertEquals(prompt === NO_GRANT_PROMPT, false)
  // Nothing else in the prompt moved: the grant swaps ONE block.
  assertStringIncludes(prompt, 'TAKE INITIATIVE')
  assertStringIncludes(prompt, 'Markdown')
  assertStringIncludes(prompt, concierge.calendar_url)
})

Deno.test('STATE 3 — a consent withdrawn AFTER a promise adds an explicit correction', () => {
  const prompt = buildConciergeSystemPrompt(concierge, null, {
    grant: null,
    promisedAt: '2026-08-13T10:05:00.000Z',
    consentState: 'withdrawn',
  })
  // The prohibition is BACK, in full...
  assertStringIncludes(prompt, 'NEVER promise anything the system cannot do')
  assertStringIncludes(prompt, 'CANNOT notify anyone')
  // ...and the mention is gone.
  assertEquals(prompt.includes(FOLLOW_UP_PHRASE), false)
  // ...plus the correction, because the model is about to re-read its OWN
  // earlier promise in the conversation history and will otherwise keep the
  // story going. Silence reads to the visitor as "still coming".
  assertStringIncludes(prompt, 'CORRECTION REQUIRED')
  assertStringIncludes(prompt, 'no email will be sent')
  assertStringIncludes(prompt, 'do NOT ask them')
  // Stated in the coach's language, since that is the reply it has to open.
  assertStringIncludes(prompt, 'in German, in one')
  const en = buildConciergeSystemPrompt({ ...concierge, language: 'en' }, null, {
    promisedAt: '2026-08-13T10:05:00.000Z',
    consentState: 'withdrawn',
  })
  assertStringIncludes(en, 'in English, in one')
})

Deno.test('STATE 3 — the correction needs BOTH a prior promise and a withdrawal', () => {
  // A withdrawal with no promise ever made has nothing to correct: the model's
  // history contains no claim, and inventing one ("no email will be sent") would
  // be a statement about a thing the visitor was never told.
  assertEquals(
    buildConciergeSystemPrompt(concierge, null, { consentState: 'withdrawn' }),
    NO_GRANT_PROMPT,
  )
  // A promise that is merely un-granted right now is NOT corrected. Only a
  // withdrawal makes the dispatcher cancel outright (decide.ts rule 4); a coach
  // pausing or an entitlement lapsing makes it DEFER, so the mail may still
  // arrive and retracting the promise would be a second false statement.
  assertEquals(
    buildConciergeSystemPrompt(concierge, null, { promisedAt: '2026-08-13T10:05:00.000Z' }),
    NO_GRANT_PROMPT,
  )
  assertEquals(
    buildConciergeSystemPrompt(concierge, null, {
      promisedAt: '2026-08-13T10:05:00.000Z',
      consentState: 'confirmed',
    }),
    NO_GRANT_PROMPT,
  )
})

Deno.test('the follow-up state composes with a pending qualifying question', () => {
  // The two blocks are independent: a grant must not swallow the qualification
  // instruction, which is what actually drives the buttons under the reply.
  const prompt = buildConciergeSystemPrompt(
    concierge,
    { id: 'budget', question: 'What is your budget?', options: [{ label: '5k+', qualifies: true }] },
    { grant: realGrant() },
  )
  assertStringIncludes(prompt, FOLLOW_UP_PHRASE)
  assertStringIncludes(prompt, 'What is your budget?')
  assertStringIncludes(prompt, 'do NOT list or mention the answer options')
})

Deno.test('generateConciergeReply forwards the follow-up state into the system prompt', async () => {
  let system = ''
  const complete: ChatCompleteFn = (s) => {
    system = s
    return Promise.resolve('ok')
  }
  await generateConciergeReply(
    { concierge, history: [], message: 'Kommt da noch was?', followUp: { grant: realGrant() } },
    { complete },
  )
  assertStringIncludes(system, FOLLOW_UP_PHRASE)
})

Deno.test('generateConciergeReply without a follow-up state sends the frozen prompt', async () => {
  let system = ''
  const complete: ChatCompleteFn = (s) => {
    system = s
    return Promise.resolve('ok')
  }
  await generateConciergeReply({ concierge, history: [], message: 'hi' }, { complete })
  assertEquals(system, NO_GRANT_PROMPT)
})
