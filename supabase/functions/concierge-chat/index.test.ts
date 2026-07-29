import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { handleConciergeChat, isExpiredDemo } from './index.ts'
import type { ChatCompleteFn, ClassifyAnswerFn, ClassifyResult } from '../_shared/conciergeChat.ts'

// A fake admin client modelling exactly the calls handleConciergeChat makes:
//   concierges:               select.eq(slug).eq(is_active).maybeSingle
//   concierge_conversations:  upsert(...).select(id).maybeSingle (new session ->
//                             returns row; existing session -> null, then the
//                             conflict-path select.eq.eq.maybeSingle reads the id)
//   concierge_messages:       select history by conversation_id (order/limit);
//                             insert turns
// It records inserts + the conversation outcome update so tests can assert them.
interface Captured {
  conciergeRow: Record<string, unknown> | null
  existingConversation:
    | { id: string; outcome: string; qualification_answers?: unknown[]; visitor_email?: string; phase?: string }
    | null
  // qualification_answers the new-session upsert returns (defaults to []).
  newConversationAnswers: unknown[]
  // phase the new-session upsert returns (defaults to 'contact', as the column does).
  newConversationPhase: string
  history: Array<{ role: string; content: string }>
  insertedMessages: Array<Record<string, unknown>>
  insertedConversation: Record<string, unknown> | null
  outcomeUpdate: string | null
  // The qualification update the handler applies on a quick-reply answer.
  qualificationUpdate: { qualification_answers: unknown[]; qualified: boolean | null } | null
  // The contact update applied when the visitor submits the name/email form.
  contactUpdate: { visitor_name: unknown; visitor_email: unknown } | null
  // The most recent phase the handler wrote (via any conversation update patch).
  phaseUpdate: string | null
}

function makeCaptured(overrides: Partial<Captured> = {}): Captured {
  return {
    conciergeRow: {
      id: 'con-1',
      business_name: 'Acme',
      offer_description: 'A program.',
      qa: '',
      tone: 'friendly',
      language: 'de',
      calendar_url: 'https://cal.com/acme',
      qualification_criteria: [],
    },
    existingConversation: null,
    newConversationAnswers: [],
    newConversationPhase: 'contact',
    history: [],
    insertedMessages: [],
    insertedConversation: null,
    outcomeUpdate: null,
    qualificationUpdate: null,
    contactUpdate: null,
    phaseUpdate: null,
    ...overrides,
  }
}

function fakeAdminClient(c: Captured) {
  return () => ({
    from(table: string) {
      if (table === 'concierges') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return { maybeSingle: () => Promise.resolve({ data: c.conciergeRow, error: null }) }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'concierge_conversations') {
        return {
          // Atomic upsert: a new session inserts and returns its row; an existing
          // session conflicts (ignoreDuplicates) and gets NO row back.
          upsert(row: Record<string, unknown>) {
            c.insertedConversation = row
            return {
              select() {
                return {
                  maybeSingle: () =>
                    Promise.resolve({
                      data: c.existingConversation
                        ? null
                        : { id: 'conv-new', qualification_answers: c.newConversationAnswers, phase: c.newConversationPhase, ...row },
                      error: null,
                    }),
                }
              },
            }
          },
          // Conflict path: read the existing conversation id + answers by the key.
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle: () => Promise.resolve({ data: c.existingConversation, error: null }),
                    }
                  },
                }
              },
            }
          },
          update(patch: Record<string, unknown>) {
            // The handler issues two kinds of update: booking outcome, or the
            // quick-reply qualification (answers + qualified). Capture each.
            if ('outcome' in patch) c.outcomeUpdate = patch.outcome as string
            if ('phase' in patch) c.phaseUpdate = patch.phase as string
            if ('qualification_answers' in patch) {
              c.qualificationUpdate = {
                qualification_answers: patch.qualification_answers as unknown[],
                qualified: patch.qualified as boolean | null,
              }
            }
            if ('visitor_email' in patch) {
              c.contactUpdate = { visitor_name: patch.visitor_name, visitor_email: patch.visitor_email }
            }
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      }
      if (table === 'concierge_messages') {
        return {
          select() {
            return {
              eq() {
                return {
                  // Handler fetches newest-first with a limit, then reverses to
                  // oldest-first. The mock returns history already oldest-first,
                  // so hand back a newest-first copy for the handler to reverse.
                  order: () => ({
                    limit: () => Promise.resolve({ data: [...c.history].reverse(), error: null }),
                  }),
                }
              },
            }
          },
          insert(rows: Record<string, unknown>[]) {
            for (const r of (Array.isArray(rows) ? rows : [rows])) c.insertedMessages.push(r)
            return Promise.resolve({ error: null })
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  })
}

function postReq(body: unknown) {
  return new Request('http://localhost/concierge-chat', { method: 'POST', body: JSON.stringify(body) })
}

const cannedComplete = (text: string): ChatCompleteFn => () => Promise.resolve(text)

Deno.test('OPTIONS preflight returns CORS headers without touching the model', async () => {
  const c = makeCaptured()
  const req = new Request('http://localhost/concierge-chat', { method: 'OPTIONS' })
  const res = await handleConciergeChat(req, { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('x') })
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
  await res.body?.cancel()
})

Deno.test('a rate-limited IP gets 429 and the model is never called', async () => {
  const c = makeCaptured()
  let modelCalled = false
  const complete: ChatCompleteFn = () => {
    modelCalled = true
    return Promise.resolve('x')
  }
  const res = await handleConciergeChat(postReq({ slug: 'acme', session_id: 's1', message: 'hi' }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete,
    checkRateLimit: () => Promise.resolve(false),
  })
  assertEquals(res.status, 429)
  assertEquals((await res.json()).error, 'rate_limited')
  assertEquals(modelCalled, false)
})

Deno.test('replies to a visitor message grounded in the concierge, persists both turns', async () => {
  const c = makeCaptured()
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', message: 'Wie lange dauert es?' }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('Es dauert 12 Wochen.') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.reply, 'Es dauert 12 Wochen.')
  assertEquals(json.show_booking, false)
  // Both the user message and the assistant reply were persisted.
  const roles = c.insertedMessages.map((m) => m.role)
  assertEquals(roles, ['user', 'assistant'])
  assertEquals(c.insertedMessages[0].content, 'Wie lange dauert es?')
  assertEquals(c.insertedMessages[1].content, 'Es dauert 12 Wochen.')
})

Deno.test('booking intent with NO contact yet: asks for name/email instead of the link', async () => {
  const c = makeCaptured()
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', message: 'Ich will buchen' }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('Gerne! Buche hier: https://cal.com/acme') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  // Booking is gated behind contact: the form is requested, no link/button yet.
  assertEquals(json.request_contact, true)
  assertEquals(json.show_booking, false)
  assertEquals(json.calendar_url, undefined)
})

Deno.test('booking intent WITH contact on file: reply surfaces the link -> show_booking true', async () => {
  const c = makeCaptured({
    existingConversation: { id: 'conv-x', outcome: 'open', qualification_answers: [], visitor_email: 'lead@x.de' },
  })
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', message: 'Ich will buchen' }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('Gerne! Buche hier: https://cal.com/acme') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.show_booking, true)
  assertEquals(json.calendar_url, 'https://cal.com/acme')
  assertEquals(c.outcomeUpdate, 'booking_shown')
})

Deno.test('contact form submission stores name + email and OPENS with the questions gate', async () => {
  const c = makeCaptured()
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', contact: { name: 'Max Muster', email: 'max@example.com' } }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('unused') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  // Contact is the OPENING step: greet by name, then ask whether they have
  // questions BEFORE anything else. No booking yet.
  assertEquals(json.show_booking, false)
  assertEquals(json.calendar_url, undefined)
  assertStringIncludes(json.reply, 'Max Muster')
  // The intro question-gate is offered as a Yes/No quick reply.
  assertEquals(json.quick_replies.criterion_id, '__intro_gate__')
  assertEquals(json.quick_replies.options.length, 2)
  assertEquals(c.phaseUpdate, 'intro_gate')
  // Stored on the conversation; the outcome is NOT advanced to booking (it's the start).
  assertEquals(c.contactUpdate!.visitor_name, 'Max Muster')
  assertEquals(c.contactUpdate!.visitor_email, 'max@example.com')
  assertEquals(c.outcomeUpdate, null)
  // The contact is logged to the transcript so the coach sees it.
  assertStringIncludes(c.insertedMessages[0].content as string, 'max@example.com')
})

Deno.test('contact form submission WITH criteria still opens with the questions gate first', async () => {
  const c = makeCaptured()
  c.conciergeRow!.qualification_criteria = [budgetCriterion, timelineCriterion]
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', contact: { name: 'Max', email: 'max@example.com' } }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('unused') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.show_booking, false)
  // Greets by name AND asks the questions gate — NOT the first criterion yet.
  assertStringIncludes(json.reply, 'Max')
  assertEquals(json.quick_replies.criterion_id, '__intro_gate__')
  assertEquals(c.phaseUpdate, 'intro_gate')
  assertEquals(c.contactUpdate!.visitor_email, 'max@example.com')
})

Deno.test('a malformed contact email is rejected (no record, normal flow)', async () => {
  const c = makeCaptured()
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', message: 'hi', contact: { name: 'Max', email: 'not-an-email' } }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('Hallo!') },
  )
  assertEquals(res.status, 200)
  // Invalid contact ignored -> falls through to the normal message flow, nothing stored.
  assertEquals(c.contactUpdate, null)
})

Deno.test('the fallback reply (AI unsure) is returned verbatim and does not surface booking', async () => {
  const c = makeCaptured()
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', message: 'Bietet ihr Ratenzahlung?' }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('Das kläre ich gern — ich lasse Acme sich bei dir melden.') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.show_booking, false)
  assertEquals(json.reply.includes('Acme'), true)
})

Deno.test('unknown / inactive slug returns 404 not_found and never calls the model', async () => {
  const c = makeCaptured({ conciergeRow: null })
  let modelCalled = false
  const res = await handleConciergeChat(
    postReq({ slug: 'nope', session_id: 'sess-1', message: 'hi' }),
    {
      createAdminClient: fakeAdminClient(c) as never,
      complete: () => {
        modelCalled = true
        return Promise.resolve('should not happen')
      },
    },
  )
  assertEquals(res.status, 404)
  assertEquals((await res.json()).error, 'not_found')
  assertEquals(modelCalled, false)
  assertEquals(c.insertedMessages.length, 0)
})

Deno.test('missing slug / message returns 400', async () => {
  const c = makeCaptured()
  const res = await handleConciergeChat(
    postReq({ session_id: 'sess-1' }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('x') },
  )
  assertEquals(res.status, 400)
})

Deno.test('the response payload never contains the offer_description or qa', async () => {
  const c = makeCaptured()
  c.conciergeRow!.offer_description = 'SECRET-OFFER-TEXT'
  c.conciergeRow!.qa = 'SECRET-QA-TEXT'
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', message: 'hi' }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('Hallo!') },
  )
  const raw = await res.text()
  assertEquals(raw.includes('SECRET-OFFER-TEXT'), false)
  assertEquals(raw.includes('SECRET-QA-TEXT'), false)
})

Deno.test('a message over 2000 chars returns 400 message_too_long and never calls the model', async () => {
  const c = makeCaptured()
  let modelCalled = false
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', message: 'x'.repeat(2001) }),
    {
      createAdminClient: fakeAdminClient(c) as never,
      complete: () => {
        modelCalled = true
        return Promise.resolve('should not happen')
      },
    },
  )
  assertEquals(res.status, 400)
  assertEquals((await res.json()).error, 'message_too_long')
  assertEquals(modelCalled, false)
  assertEquals(c.insertedMessages.length, 0)
})

Deno.test('a session_id over 256 chars returns 400 session_id_too_long and never calls the model', async () => {
  const c = makeCaptured()
  let modelCalled = false
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 's'.repeat(257), message: 'hi' }),
    {
      createAdminClient: fakeAdminClient(c) as never,
      complete: () => {
        modelCalled = true
        return Promise.resolve('should not happen')
      },
    },
  )
  assertEquals(res.status, 400)
  assertEquals((await res.json()).error, 'session_id_too_long')
  assertEquals(modelCalled, false)
  assertEquals(c.insertedMessages.length, 0)
})

Deno.test('when the model throws (Gemini down) the handler returns 502 and never leaks the visitor message', async () => {
  const c = makeCaptured()
  const secretMessage = 'LEAK-ME-VISITOR-SECRET'
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', message: secretMessage }),
    {
      createAdminClient: fakeAdminClient(c) as never,
      complete: () => Promise.reject(new Error('gemini unavailable')),
    },
  )
  assertEquals(res.status, 502)
  const raw = await res.text()
  assertEquals(JSON.parse(raw).error, 'concierge_chat_failed')
  // The failure body must not echo the visitor's message back to the browser.
  assertEquals(raw.includes(secretMessage), false)
})

// --- Qualification quick-replies (S-C) ---------------------------------------

const budgetCriterion = {
  id: 'budget',
  question: 'What is your budget?',
  options: [
    { label: '5k+', qualifies: true },
    { label: '<1k', qualifies: false },
  ],
}
const timelineCriterion = {
  id: 'timeline_role',
  question: 'When do you want to start?',
  options: [
    { label: 'Now', qualifies: true },
    { label: 'Someday', qualifies: false },
  ],
}

Deno.test('a normal message with criteria configured attaches quick_replies for the first criterion', async () => {
  const c = makeCaptured()
  c.conciergeRow!.qualification_criteria = [budgetCriterion, timelineCriterion]
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', message: 'Hi' }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('Hallo!') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.reply, 'Hallo!')
  // The next unanswered criterion (the first) comes back as a QualPrompt.
  assertEquals(json.quick_replies.criterion_id, 'budget')
  assertEquals(json.quick_replies.question, 'What is your budget?')
  assertEquals(json.quick_replies.options.length, 2)
})

Deno.test('sending an answer records it, sets qualified, returns the next prompt, and NEVER calls the model', async () => {
  const c = makeCaptured()
  c.conciergeRow!.qualification_criteria = [budgetCriterion, timelineCriterion]
  let modelCalled = false
  const complete: ChatCompleteFn = () => {
    modelCalled = true
    return Promise.resolve('should not happen')
  }
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: '5k+',
      answer: { criterion_id: 'budget', label: '5k+', qualifies: true },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  // No model call this turn, but the bot line is coherent: a short ack PLUS the
  // next question, so the text above the next buttons reads as the bot asking it.
  assertEquals(json.reply.startsWith('Danke!'), true)
  assertEquals(json.reply.includes('When do you want to start?'), true)
  assertEquals(json.show_booking, false)
  assertEquals(modelCalled, false)
  // The answer was appended and qualified recomputed (one qualifying answer).
  assertEquals(c.qualificationUpdate!.qualification_answers.length, 1)
  assertEquals(c.qualificationUpdate!.qualified, true)
  // The clicked label is logged as a user message AND the ack as an assistant
  // message, so the thread stays coherent for history.
  assertEquals(c.insertedMessages.length, 2)
  assertEquals(c.insertedMessages[0].role, 'user')
  assertEquals(c.insertedMessages[0].content, '5k+')
  assertEquals(c.insertedMessages[1].role, 'assistant')
  assertEquals(c.insertedMessages[1].content, json.reply)
  // The NEXT unanswered criterion is returned.
  assertEquals(json.quick_replies.criterion_id, 'timeline_role')
})

Deno.test('answering the last criterion opens the FINAL questions gate (not booking yet), qualified false on a disqualifying answer', async () => {
  const c = makeCaptured()
  c.conciergeRow!.qualification_criteria = [timelineCriterion, budgetCriterion]
  c.newConversationPhase = 'qualifying'
  c.newConversationAnswers = [{ criterion_id: 'timeline_role', label: 'Now', qualifies: true }]
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: '<1k',
      answer: { criterion_id: 'budget', label: '<1k', qualifies: false },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('nope') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  // Qualification done -> we do NOT book yet. We ask once more whether they have
  // questions before the link (the final gate), as a Yes/No quick reply.
  assertEquals(json.quick_replies.criterion_id, '__final_gate__')
  assertEquals(json.show_booking, false)
  assertEquals(c.phaseUpdate, 'final_gate')
  // AND-rule: one disqualifying answer makes the whole conversation not qualified.
  assertEquals(c.qualificationUpdate!.qualification_answers.length, 2)
  assertEquals(c.qualificationUpdate!.qualified, false)
})

Deno.test('answering the last criterion WITH contact on file also opens the final gate first', async () => {
  const c = makeCaptured({
    existingConversation: {
      id: 'conv-x',
      outcome: 'open',
      phase: 'qualifying',
      qualification_answers: [{ criterion_id: 'timeline_role', label: 'Now', qualifies: true }],
      visitor_email: 'lead@x.de',
    },
  })
  c.conciergeRow!.qualification_criteria = [timelineCriterion, budgetCriterion]
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: '5k+',
      answer: { criterion_id: 'budget', label: '5k+', qualifies: true },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('nope') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  // Even with contact on file, qualification-complete opens the final gate, not booking.
  assertEquals(json.show_booking, false)
  assertEquals(json.quick_replies.criterion_id, '__final_gate__')
  assertEquals(c.phaseUpdate, 'final_gate')
})

Deno.test('a concierge with NO criteria behaves exactly as before (no quick_replies)', async () => {
  const c = makeCaptured() // qualification_criteria defaults to []
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', message: 'Wie lange?' }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('12 Wochen.') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.reply, '12 Wochen.')
  assertEquals(json.quick_replies, undefined)
  // Existing flow intact: both turns persisted.
  assertEquals(c.insertedMessages.map((m) => m.role), ['user', 'assistant'])
})

// --- Free-text answers to a pending qualification question (v1.3) ------------
// The confirmed live bug: when a quick-reply prompt is showing and the visitor
// TYPES instead of clicking, the typed answer was discarded and the same
// criterion re-attached forever. Now the server classifies the text. The
// classifier is INJECTED so these stay offline.

const classifyStub = (result: ClassifyResult): ClassifyAnswerFn => () => Promise.resolve(result)

Deno.test('typed text that MATCHES an option is recorded (verbatim label) + advances + buttons move to next', async () => {
  const c = makeCaptured()
  c.conciergeRow!.qualification_criteria = [budgetCriterion, timelineCriterion]
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'we have around 8k to invest',
      pending_criterion_id: 'budget',
    }),
    {
      createAdminClient: fakeAdminClient(c) as never,
      complete: cannedComplete('Großartig! Wann möchtest du starten?'),
      classifyAnswer: classifyStub({ kind: 'matched', option: budgetCriterion.options[0] }),
    },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  // The answer was recorded with the VERBATIM typed text as the label, qualifies
  // taken from the matched option, and qualified recomputed.
  assertEquals(c.qualificationUpdate!.qualification_answers.length, 1)
  assertEquals(
    (c.qualificationUpdate!.qualification_answers[0] as { criterion_id: string; label: string; qualifies: boolean }),
    { criterion_id: 'budget', label: 'we have around 8k to invest', qualifies: true },
  )
  assertEquals(c.qualificationUpdate!.qualified, true)
  // The model still ran a normal reply, and the buttons advanced to the NEXT criterion.
  assertEquals(json.reply, 'Großartig! Wann möchtest du starten?')
  assertEquals(json.quick_replies.criterion_id, 'timeline_role')
  // Both turns persisted as a normal reply turn.
  assertEquals(c.insertedMessages.map((m) => m.role), ['user', 'assistant'])
})

Deno.test('typed text classified OTHER is recorded qualifies=false + advances to the next criterion', async () => {
  const c = makeCaptured()
  c.conciergeRow!.qualification_criteria = [budgetCriterion, timelineCriterion]
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'it depends on the value',
      pending_criterion_id: 'budget',
    }),
    {
      createAdminClient: fakeAdminClient(c) as never,
      complete: cannedComplete('Verstande. Wann möchtest du starten?'),
      classifyAnswer: classifyStub({ kind: 'other' }),
    },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  // Recorded as an off-menu answer: verbatim label, qualifies=false.
  assertEquals(c.qualificationUpdate!.qualification_answers.length, 1)
  assertEquals(
    (c.qualificationUpdate!.qualification_answers[0] as { label: string; qualifies: boolean }),
    { criterion_id: 'budget', label: 'it depends on the value', qualifies: false } as never,
  )
  // AND-rule: one non-qualifying answer makes the conversation not qualified.
  assertEquals(c.qualificationUpdate!.qualified, false)
  // Advances to the next criterion's buttons.
  assertEquals(json.quick_replies.criterion_id, 'timeline_role')
})

Deno.test('typed text classified NONE is NOT recorded; the same criterion stays pending', async () => {
  const c = makeCaptured()
  c.conciergeRow!.qualification_criteria = [budgetCriterion, timelineCriterion]
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'wait, what exactly is included?',
      pending_criterion_id: 'budget',
    }),
    {
      createAdminClient: fakeAdminClient(c) as never,
      complete: cannedComplete('Gute Frage! Es umfasst X. Wie hoch ist dein Budget?'),
      classifyAnswer: classifyStub({ kind: 'none' }),
    },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  // Nothing recorded: it wasn't an answer, just a real question.
  assertEquals(c.qualificationUpdate, null)
  // The SAME criterion is still returned (re-asked), so the buttons stay on budget.
  assertEquals(json.quick_replies.criterion_id, 'budget')
  // The bot still answered naturally.
  assertEquals(json.reply, 'Gute Frage! Es umfasst X. Wie hoch ist dein Budget?')
})

Deno.test('a stale pending_criterion_id (already answered) is ignored: no double-record', async () => {
  const c = makeCaptured()
  c.conciergeRow!.qualification_criteria = [budgetCriterion, timelineCriterion]
  // Budget already answered; a stale pending id for it must not re-classify/record.
  c.newConversationAnswers = [{ criterion_id: 'budget', label: '5k+', qualifies: true }]
  let classifierCalled = false
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'something',
      pending_criterion_id: 'budget',
    }),
    {
      createAdminClient: fakeAdminClient(c) as never,
      complete: cannedComplete('Wann möchtest du starten?'),
      classifyAnswer: () => {
        classifierCalled = true
        return Promise.resolve({ kind: 'matched', option: budgetCriterion.options[0] })
      },
    },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(classifierCalled, false)
  assertEquals(c.qualificationUpdate, null)
  // The next unanswered criterion (timeline) is what gets asked.
  assertEquals(json.quick_replies.criterion_id, 'timeline_role')
})

// --- Question-gate flow (email -> "any questions?" -> qualify -> "any questions
// before the link?" -> booking) -------------------------------------------------
// After contact, the conversation runs a controlled flow tracked by `phase`. The
// Yes/No gates and the "no more questions" exit are quick_replies with reserved
// control criterion ids (__intro_gate__, __final_gate__, __done_questions__), so
// no client change is needed. These never call the model unless a question is typed.

// A conversation that already captured contact and sits in a given phase.
function contacted(phase: string, answers: unknown[] = []) {
  return {
    existingConversation: {
      id: 'conv-x',
      outcome: 'open',
      phase,
      qualification_answers: answers,
      visitor_email: 'lead@x.de',
    },
  }
}
const failIfModelCalled = (): [ChatCompleteFn, () => boolean] => {
  let called = false
  const fn: ChatCompleteFn = () => {
    called = true
    return Promise.resolve('should not happen')
  }
  return [fn, () => called]
}

Deno.test('intro gate: YES opens the free-type Q&A loop with a single "no more questions" exit button, no model call', async () => {
  const c = makeCaptured(contacted('intro_gate'))
  const [complete, wasCalled] = failIfModelCalled()
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'Ja, ich habe Fragen',
      answer: { criterion_id: '__intro_gate__', label: 'Ja, ich habe Fragen', qualifies: true },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.show_booking, false)
  assertEquals(json.quick_replies.criterion_id, '__done_questions__')
  assertEquals(json.quick_replies.options.length, 1)
  assertEquals(c.phaseUpdate, 'answering_intro')
  assertEquals(wasCalled(), false)
})

Deno.test('intro gate: NO with criteria moves to the first qualifying question, no model call', async () => {
  const c = makeCaptured(contacted('intro_gate'))
  c.conciergeRow!.qualification_criteria = [budgetCriterion, timelineCriterion]
  const [complete, wasCalled] = failIfModelCalled()
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'Nein, lass uns loslegen',
      answer: { criterion_id: '__intro_gate__', label: 'Nein, lass uns loslegen', qualifies: false },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.quick_replies.criterion_id, 'budget')
  assertStringIncludes(json.reply, 'What is your budget?')
  assertEquals(json.show_booking, false)
  assertEquals(c.phaseUpdate, 'qualifying')
  assertEquals(wasCalled(), false)
})

Deno.test('intro gate: NO with NO criteria goes straight to booking', async () => {
  const c = makeCaptured(contacted('intro_gate')) // no criteria configured
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'Nein',
      answer: { criterion_id: '__intro_gate__', label: 'Nein', qualifies: false },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('unused') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.show_booking, true)
  assertEquals(json.calendar_url, 'https://cal.com/acme')
  assertEquals(c.phaseUpdate, 'booking')
  assertEquals(c.outcomeUpdate, 'booking_shown')
})

Deno.test('answering_intro: a typed question is answered grounded, booking stays suppressed, exit button re-shown', async () => {
  const c = makeCaptured(contacted('answering_intro'))
  const res = await handleConciergeChat(
    // The model returns a reply that even contains the calendar link; the gate must
    // still NOT surface the booking button while we are in the questions loop.
    postReq({ slug: 'acme', session_id: 'sess-1', message: 'Bietet ihr Ratenzahlung?' }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('Ja. Mehr dazu hier: https://cal.com/acme') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertStringIncludes(json.reply, 'Ja.')
  assertEquals(json.show_booking, false)
  assertEquals(json.calendar_url, undefined)
  // Still in the loop: the exit button comes back, phase unchanged.
  assertEquals(json.quick_replies.criterion_id, '__done_questions__')
  assertEquals(c.insertedMessages.map((m) => m.role), ['user', 'assistant'])
})

Deno.test('answering_intro: the exit button with criteria advances to qualification, no model call', async () => {
  const c = makeCaptured(contacted('answering_intro'))
  c.conciergeRow!.qualification_criteria = [budgetCriterion, timelineCriterion]
  const [complete, wasCalled] = failIfModelCalled()
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'Ich habe keine Fragen mehr',
      answer: { criterion_id: '__done_questions__', label: 'Ich habe keine Fragen mehr', qualifies: false },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.quick_replies.criterion_id, 'budget')
  assertEquals(c.phaseUpdate, 'qualifying')
  assertEquals(wasCalled(), false)
})

Deno.test('answering_intro: the exit button with NO criteria goes to booking', async () => {
  const c = makeCaptured(contacted('answering_intro'))
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'Ich habe keine Fragen mehr',
      answer: { criterion_id: '__done_questions__', label: 'Ich habe keine Fragen mehr', qualifies: false },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('unused') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.show_booking, true)
  assertEquals(c.phaseUpdate, 'booking')
  assertEquals(c.outcomeUpdate, 'booking_shown')
})

Deno.test('final gate: NO sends the booking link directly', async () => {
  const c = makeCaptured(contacted('final_gate'))
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'Nein',
      answer: { criterion_id: '__final_gate__', label: 'Nein', qualifies: false },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('unused') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.show_booking, true)
  assertEquals(json.calendar_url, 'https://cal.com/acme')
  assertStringIncludes(json.reply, 'Termin')
  assertEquals(c.phaseUpdate, 'booking')
  assertEquals(c.outcomeUpdate, 'booking_shown')
})

Deno.test('revealBooking without contact on file asks for name/email instead of the link (defense in depth)', async () => {
  // A conversation somehow at the booking-reveal step with no visitor_email (an
  // inconsistent state the phase guards should prevent). revealBooking must gate
  // on contact: request the form, never hand over show_booking/calendar_url.
  const c = makeCaptured({
    existingConversation: { id: 'conv-x', outcome: 'open', phase: 'final_gate', qualification_answers: [] },
  }) // note: no visitor_email -> hasContact is false
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'Nein',
      answer: { criterion_id: '__final_gate__', label: 'Nein, alles klar', qualifies: false },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('unused') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.request_contact, true)
  assertEquals(json.show_booking, false)
  assertEquals(json.calendar_url, undefined)
  // Never advanced to booking_shown without a lead.
  assertEquals(c.outcomeUpdate, null)
})

Deno.test('final gate: YES re-opens the Q&A loop before booking, no model call', async () => {
  const c = makeCaptured(contacted('final_gate'))
  const [complete, wasCalled] = failIfModelCalled()
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'Ja, ich habe Fragen',
      answer: { criterion_id: '__final_gate__', label: 'Ja, ich habe Fragen', qualifies: true },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.show_booking, false)
  assertEquals(json.quick_replies.criterion_id, '__done_questions__')
  assertEquals(c.phaseUpdate, 'answering_final')
  assertEquals(wasCalled(), false)
})

Deno.test('answering_final: a typed question is answered grounded with booking suppressed, exit button re-shown', async () => {
  const c = makeCaptured(contacted('answering_final'))
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', message: 'Wie lange dauert der Call?' }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('Etwa 30 Minuten.') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.reply, 'Etwa 30 Minuten.')
  assertEquals(json.show_booking, false)
  assertEquals(json.quick_replies.criterion_id, '__done_questions__')
})

Deno.test('answering_final: the exit button sends the booking link', async () => {
  const c = makeCaptured(contacted('answering_final'))
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'Ich habe keine Fragen mehr',
      answer: { criterion_id: '__done_questions__', label: 'Ich habe keine Fragen mehr', qualifies: false },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('unused') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.show_booking, true)
  assertEquals(json.calendar_url, 'https://cal.com/acme')
  assertEquals(c.phaseUpdate, 'booking')
})

Deno.test('the exit button at a non-answering phase does NOT reveal booking (no gate/contact bypass)', async () => {
  // Guard against a crafted/stale __done_questions__ click: a no-criteria concierge
  // must not hand over the booking link on a fresh session (phase 'contact'), which
  // would skip contact capture and both gates. It falls through to normal handling.
  const c = makeCaptured() // fresh session -> phase 'contact', no criteria, no contact
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-attack',
      message: 'x',
      answer: { criterion_id: '__done_questions__', label: 'Ich habe keine Fragen mehr', qualifies: false },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('Hallo!') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  // No booking revealed, no calendar link, outcome never advanced to booking_shown.
  assertEquals(json.show_booking, false)
  assertEquals(json.calendar_url, undefined)
  assertEquals(c.outcomeUpdate, null)
  // The control id must NOT be recorded as a qualification answer.
  assertEquals(c.qualificationUpdate, null)
})

Deno.test('the exit button at the qualifying phase does NOT skip to booking', async () => {
  // A stale exit click while a qualification question is pending must not advance
  // past qualification; it falls through (the criterion stays to be answered).
  const c = makeCaptured(contacted('qualifying'))
  c.conciergeRow!.qualification_criteria = [budgetCriterion, timelineCriterion]
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'x',
      answer: { criterion_id: '__done_questions__', label: 'Ich habe keine Fragen mehr', qualifies: false },
    }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('Hallo!') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.show_booking, false)
  assertEquals(c.outcomeUpdate, null)
  // Not recorded as a qualification answer either.
  assertEquals(c.qualificationUpdate, null)
})

Deno.test('typing a question at the intro gate (instead of clicking) enters the Q&A loop and answers it', async () => {
  const c = makeCaptured(contacted('intro_gate'))
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', message: 'Wie läuft das ab?' }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('So und so läuft es ab.') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.reply, 'So und so läuft es ab.')
  assertEquals(json.show_booking, false)
  assertEquals(json.quick_replies.criterion_id, '__done_questions__')
  assertEquals(c.phaseUpdate, 'answering_intro')
})

Deno.test('typing a question at the final gate (instead of clicking) enters the Q&A loop and answers it', async () => {
  const c = makeCaptured(contacted('final_gate'))
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', message: 'Eine letzte Frage noch' }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('Klar, klaeren wir.') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.reply, 'Klar, klaeren wir.')
  assertEquals(json.show_booking, false)
  assertEquals(json.quick_replies.criterion_id, '__done_questions__')
  assertEquals(c.phaseUpdate, 'answering_final')
})

Deno.test('a probe returns the concierge language and name without a conversation or model call', async () => {
  // The public page asks which language a slug speaks BEFORE the first turn, so
  // its opening screen matches the coach's setting instead of the browser's.
  const c = makeCaptured()
  let modelCalled = false
  const complete: ChatCompleteFn = () => {
    modelCalled = true
    return Promise.resolve('x')
  }
  const res = await handleConciergeChat(postReq({ slug: 'acme', probe: true }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete,
  })
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.language, 'de')
  assertEquals(json.business_name, 'Acme')
  // A probe is not a turn: no model, no conversation, no messages.
  assertEquals(modelCalled, false)
  assertEquals(c.insertedConversation, null)
  assertEquals(c.insertedMessages.length, 0)
  // And the coach's private knowledge never rides along. calendar_url matters
  // as much as offer/qa: the booking link is the payload the whole qualification
  // flow gates, and this response is public and session-less.
  assertEquals(json.offer_description, undefined)
  assertEquals(json.qa, undefined)
  assertEquals(json.calendar_url, undefined)
  assertEquals(json.qualification_criteria, undefined)
  assertEquals(json.show_booking, undefined)
})

Deno.test('a probe for an unknown slug still 404s', async () => {
  const c = makeCaptured({ conciergeRow: null })
  const res = await handleConciergeChat(postReq({ slug: 'nope', probe: true }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('x'),
  })
  assertEquals(res.status, 404)
  assertEquals((await res.json()).error, 'not_found')
})

// --- Demo concierges: disclosure + expiry (migration 20260727120000) ---------
// A demo concierge is a public page speaking as a named real business, so the
// page must be able to SAY it is a demo, and the row must be able to stop
// serving on its own.

Deno.test('a probe reports is_demo so the page can render its disclosure', async () => {
  const c = makeCaptured({
    conciergeRow: { ...makeCaptured().conciergeRow, is_demo: true } as never,
  })
  const res = await handleConciergeChat(postReq({ slug: 'acme', probe: true }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('x'),
  })
  assertEquals(res.status, 200)
  assertEquals((await res.json()).is_demo, true)
})

Deno.test('a probe on a real customer concierge reports is_demo false, not undefined', async () => {
  // The page renders the disclosure on a boolean. An older row whose column is
  // null must read as "not a demo", never as a missing field the page has to
  // guess about.
  const c = makeCaptured({
    conciergeRow: { ...makeCaptured().conciergeRow, is_demo: null } as never,
  })
  const res = await handleConciergeChat(postReq({ slug: 'acme', probe: true }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('x'),
  })
  assertEquals((await res.json()).is_demo, false)
})

Deno.test('an expired demo 404s on the probe, exactly like an unknown link', async () => {
  const c = makeCaptured({
    conciergeRow: {
      ...makeCaptured().conciergeRow,
      is_demo: true,
      demo_expires_at: '2026-07-01T00:00:00Z',
    } as never,
  })
  const res = await handleConciergeChat(postReq({ slug: 'acme', probe: true }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('x'),
    now: () => new Date('2026-07-27T00:00:00Z'),
  })
  assertEquals(res.status, 404)
  assertEquals((await res.json()).error, 'not_found')
})

Deno.test('an expired demo also 404s mid-chat, so an open tab cannot keep talking to it', async () => {
  const c = makeCaptured({
    conciergeRow: {
      ...makeCaptured().conciergeRow,
      is_demo: true,
      demo_expires_at: '2026-07-01T00:00:00Z',
    } as never,
  })
  let modelCalled = false
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 's-1', message: 'hallo' }),
    {
      createAdminClient: fakeAdminClient(c) as never,
      complete: () => {
        modelCalled = true
        return Promise.resolve('x')
      },
      now: () => new Date('2026-07-27T00:00:00Z'),
    },
  )
  assertEquals(res.status, 404)
  // Expiry has to bite BEFORE the model call, or an expired demo still costs money.
  assertEquals(modelCalled, false)
  await res.body?.cancel()
})

Deno.test('a demo whose expiry has not passed still serves', async () => {
  const c = makeCaptured({
    conciergeRow: {
      ...makeCaptured().conciergeRow,
      is_demo: true,
      demo_expires_at: '2026-08-30T00:00:00Z',
    } as never,
  })
  const res = await handleConciergeChat(postReq({ slug: 'acme', probe: true }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('x'),
    now: () => new Date('2026-07-27T00:00:00Z'),
  })
  assertEquals(res.status, 200)
  assertEquals((await res.json()).is_demo, true)
})

Deno.test('isExpiredDemo treats null, empty and unparseable expiries as "never expires"', () => {
  // A garbled timestamp must not silently take a live demo offline: failing
  // open is recoverable, failing closed looks like the product is broken.
  const now = new Date('2026-07-27T00:00:00Z')
  assertEquals(isExpiredDemo({}, now), false)
  assertEquals(isExpiredDemo({ demo_expires_at: null }, now), false)
  assertEquals(isExpiredDemo({ demo_expires_at: '' }, now), false)
  assertEquals(isExpiredDemo({ demo_expires_at: 'not-a-date' }, now), false)
  assertEquals(isExpiredDemo({ demo_expires_at: '2026-07-26T23:59:59Z' }, now), true)
})

Deno.test('a non-probe request still requires session_id and a message', async () => {
  const c = makeCaptured()
  const res = await handleConciergeChat(postReq({ slug: 'acme' }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('x'),
  })
  assertEquals(res.status, 400)
  await res.body?.cancel()
})

Deno.test('a probe returns the coach language verbatim (an EN concierge answers "en", not the "de" default)', async () => {
  // The probe exists precisely so an EN coach's page does not open in German.
  // The other probe test uses the "de" fixture, which a hardcoded default would
  // also satisfy — this one proves the value comes from the row.
  const c = makeCaptured({
    conciergeRow: {
      id: 'con-1',
      business_name: 'Acme Coaching',
      offer_description: 'A program.',
      qa: '',
      tone: 'friendly',
      language: 'en',
      calendar_url: 'https://cal.com/acme',
      qualification_criteria: [],
    },
  })
  const res = await handleConciergeChat(postReq({ slug: 'acme', probe: true }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('x'),
  })
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.language, 'en')
  assertEquals(json.business_name, 'Acme Coaching')
})

Deno.test('a probe without a slug is still rejected (the slug is the one thing a probe must carry)', async () => {
  const c = makeCaptured()
  const res = await handleConciergeChat(postReq({ probe: true }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('x'),
  })
  assertEquals(res.status, 400)
  // The message names the field a probe actually failed to send — telling it to
  // supply a session_id and message would point the reader at the wrong shape.
  assertEquals((await res.clone().json()).error, 'slug is required')
  // No concierge lookup, no conversation: rejected before any work.
  assertEquals(c.insertedConversation, null)
  await res.body?.cancel()
})

Deno.test('a rate-limited probe gets 429 (and must degrade, not crash)', async () => {
  // The client maps this 429 to the generic error key and keeps the chat usable
  // in the browser language.
  const c = makeCaptured()
  const res = await handleConciergeChat(postReq({ slug: 'acme', probe: true }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('x'),
    checkRateLimit: () => Promise.resolve(false),
  })
  assertEquals(res.status, 429)
  assertEquals((await res.json()).error, 'rate_limited')
})

Deno.test('a probe draws on its own rate-limit bucket, not the chat budget', async () => {
  // A probe makes no model call. Charging it against the same 30/60s bucket as
  // real turns lets a few page reloads starve the conversation the visitor came
  // for, so the two paths must use different keys.
  const c = makeCaptured()
  const keys: string[] = []
  const capture = (key: string) => {
    keys.push(key)
    return Promise.resolve(true)
  }
  await handleConciergeChat(postReq({ slug: 'acme', probe: true }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('x'),
    checkRateLimit: capture,
  })
  await handleConciergeChat(postReq({ slug: 'acme', session_id: 's1', message: 'hi' }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('reply'),
    checkRateLimit: capture,
  })
  assertEquals(keys.length, 2)
  assertEquals(keys[0].startsWith('probe:'), true)
  assertEquals(keys[1].startsWith('ip:'), true)
  assertEquals(keys[0] === keys[1], false)
})

Deno.test('a probe clamps an out-of-range language column to German', async () => {
  // concierges.language has no CHECK constraint. An unexpected value would flow
  // into the page's <html lang> while i18n silently renders German — the exact
  // mismatch the language pin exists to prevent.
  const c = makeCaptured({
    conciergeRow: {
      id: 'con-1',
      business_name: 'Acme',
      offer_description: 'A program.',
      qa: '',
      tone: 'friendly',
      language: 'fr',
      calendar_url: 'https://cal.com/acme',
      qualification_criteria: [],
    },
  })
  const res = await handleConciergeChat(postReq({ slug: 'acme', probe: true }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('x'),
  })
  assertEquals(res.status, 200)
  assertEquals((await res.json()).language, 'de')
})

Deno.test('an over-long slug is rejected before it reaches the database', async () => {
  // On a probe the slug is the only input that reaches the DB, so it gets the
  // same bound as the message and session id.
  const c = makeCaptured()
  const res = await handleConciergeChat(postReq({ slug: 'a'.repeat(129), probe: true }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('x'),
  })
  assertEquals(res.status, 400)
  assertEquals((await res.json()).error, 'slug_too_long')
})

Deno.test('probe must be literally true: a truthy string does not unlock the no-session shortcut', async () => {
  // `probe` waives the session_id/message requirement, so the check is a strict
  // === true. A sloppy or hostile body ({probe:"true"}) must fall back to the
  // normal validation rather than skipping straight past it.
  const c = makeCaptured()
  const res = await handleConciergeChat(postReq({ slug: 'acme', probe: 'true' }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('x'),
  })
  assertEquals(res.status, 400)
  await res.body?.cancel()
})

// --- Per-concierge daily spend cap (CSO 2026-07-27, finding #3) --------------
// The per-IP bucket keys on X-Forwarded-For, which the client sends, so an
// attacker rotating that header gets a fresh bucket every request and the
// per-IP cap never binds. This second bucket keys on the concierge id resolved
// server-side from the slug — forgeable IP, unforgeable concierge.

Deno.test('spend cap: a capped concierge gets 429 and the model is never called', async () => {
  const c = makeCaptured()
  let modelCalled = false
  const complete: ChatCompleteFn = () => {
    modelCalled = true
    return Promise.resolve('x')
  }
  const res = await handleConciergeChat(postReq({ slug: 'acme', session_id: 's1', message: 'hi' }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete,
    checkSpendCap: () => Promise.resolve(false),
  })
  assertEquals(res.status, 429)
  assertEquals((await res.json()).error, 'rate_limited')
  // The whole point of the cap: no Gemini call happens once it is reached.
  assertEquals(modelCalled, false)
})

Deno.test('spend cap: the bucket is keyed on the concierge id, not the caller IP', async () => {
  const c = makeCaptured()
  const keys: string[] = []
  await handleConciergeChat(postReq({ slug: 'acme', session_id: 's1', message: 'hi' }), {
    createAdminClient: fakeAdminClient(c) as never,
    complete: cannedComplete('reply'),
    checkSpendCap: (key: string) => {
      keys.push(key)
      return Promise.resolve(true)
    },
  })
  assertEquals(keys, ['conc:con-1'])
})

Deno.test('spend cap: a forged X-Forwarded-For does not buy a fresh budget', async () => {
  // The exploit this cap exists for: rotating the header defeats the per-IP
  // bucket, but every request still lands on the SAME concierge key.
  const c = makeCaptured()
  const keys: string[] = []
  const spendCap = (key: string) => {
    keys.push(key)
    return Promise.resolve(true)
  }
  for (const ip of ['1.2.3.4', '5.6.7.8', '9.10.11.12']) {
    const req = new Request('http://localhost/concierge-chat', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip },
      body: JSON.stringify({ slug: 'acme', session_id: 's1', message: 'hi' }),
    })
    const res = await handleConciergeChat(req, {
      createAdminClient: fakeAdminClient(c) as never,
      complete: cannedComplete('reply'),
      checkSpendCap: spendCap,
    })
    await res.body?.cancel()
  }
  // Three different claimed IPs, one budget.
  assertEquals(keys, ['conc:con-1', 'conc:con-1', 'conc:con-1'])
})

Deno.test('spend cap: the contact form does NOT charge the cap (no model call that turn)', async () => {
  // Charging deterministic turns would let a visitor's free steps starve the
  // conversation they came for. Only model-backed turns draw on the budget.
  const c = makeCaptured()
  let capCharged = false
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 's1', contact: { name: 'Max Muster', email: 'max@example.com' } }),
    {
      createAdminClient: fakeAdminClient(c) as never,
      complete: cannedComplete('x'),
      checkSpendCap: () => {
        capCharged = true
        return Promise.resolve(false)
      },
    },
  )
  assertEquals(res.status, 200)
  assertEquals(capCharged, false)
  await res.body?.cancel()
})

Deno.test('spend cap: a control-button turn does NOT charge the cap (no model call that turn)', async () => {
  const c = makeCaptured(contacted('intro_gate')) // no criteria configured
  let capCharged = false
  const res = await handleConciergeChat(
    postReq({
      slug: 'acme',
      session_id: 'sess-1',
      message: 'Nein',
      answer: { criterion_id: '__intro_gate__', label: 'Nein', qualifies: false },
    }),
    {
      createAdminClient: fakeAdminClient(c) as never,
      complete: cannedComplete('x'),
      checkSpendCap: () => {
        capCharged = true
        return Promise.resolve(false)
      },
    },
  )
  assertEquals(res.status, 200)
  assertEquals(capCharged, false)
  await res.body?.cancel()
})

// --- Limiter failure posture (review finding) --------------------------------
// The two buckets fail in OPPOSITE directions on a database error, and that
// asymmetry is the whole design: the per-IP limiter fails OPEN so a transient
// Postgres blip never blocks a real visitor's booking, while the per-concierge
// spend cap fails CLOSED so the same blip cannot license unbounded model spend.
// Every other test injects checkRateLimit/checkSpendCap and never reaches the
// real limiter, so without these two the branch that decides it is dead code.

// The real limiter path goes through admin.rpc. The base fake has no .rpc at
// all, which hitBucket reads as "unit-test double -> allow"; supplying one is
// what forces the production error branch to run.
function fakeAdminClientWithRpc(c: Captured, rpcResult: { data?: unknown; error?: unknown }) {
  const base = (fakeAdminClient(c) as () => Record<string, unknown>)()
  return () => ({ ...base, rpc: () => Promise.resolve(rpcResult) })
}

Deno.test('limiter DB error: the per-concierge spend cap fails CLOSED (429, no model call)', async () => {
  const c = makeCaptured()
  let modelCalled = false
  const complete: ChatCompleteFn = () => {
    modelCalled = true
    return Promise.resolve('x')
  }
  const res = await handleConciergeChat(postReq({ slug: 'acme', session_id: 's1', message: 'hi' }), {
    createAdminClient: fakeAdminClientWithRpc(c, { data: null, error: { message: 'db down' } }) as never,
    complete,
    // Isolate the spend cap: the IP gate is not what this test is about.
    checkRateLimit: () => Promise.resolve(true),
    // checkSpendCap deliberately NOT injected -> the real dbSpendCap runs.
  })
  assertEquals(res.status, 429)
  assertEquals((await res.json()).error, 'rate_limited')
  assertEquals(modelCalled, false)
})

Deno.test('limiter DB error: the per-IP limiter fails OPEN so a booking is never blocked', async () => {
  const c = makeCaptured()
  const res = await handleConciergeChat(postReq({ slug: 'acme', session_id: 's1', message: 'hi' }), {
    createAdminClient: fakeAdminClientWithRpc(c, { data: null, error: { message: 'db down' } }) as never,
    complete: cannedComplete('reply'),
    // checkRateLimit deliberately NOT injected -> the real dbRateLimit runs.
    // Isolate it: the spend cap would otherwise fail closed and mask the result.
    checkSpendCap: () => Promise.resolve(true),
  })
  assertEquals(res.status, 200)
  await res.body?.cancel()
})
