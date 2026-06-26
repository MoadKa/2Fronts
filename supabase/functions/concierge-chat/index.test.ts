import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { handleConciergeChat } from './index.ts'
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
    | { id: string; outcome: string; qualification_answers?: unknown[]; visitor_email?: string }
    | null
  // qualification_answers the new-session upsert returns (defaults to []).
  newConversationAnswers: unknown[]
  history: Array<{ role: string; content: string }>
  insertedMessages: Array<Record<string, unknown>>
  insertedConversation: Record<string, unknown> | null
  outcomeUpdate: string | null
  // The qualification update the handler applies on a quick-reply answer.
  qualificationUpdate: { qualification_answers: unknown[]; qualified: boolean | null } | null
  // The contact update applied when the visitor submits the name/email form.
  contactUpdate: { visitor_name: unknown; visitor_email: unknown } | null
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
    history: [],
    insertedMessages: [],
    insertedConversation: null,
    outcomeUpdate: null,
    qualificationUpdate: null,
    contactUpdate: null,
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
                        : { id: 'conv-new', qualification_answers: c.newConversationAnswers, ...row },
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

Deno.test('contact form submission stores name + email and returns the booking', async () => {
  const c = makeCaptured()
  const res = await handleConciergeChat(
    postReq({ slug: 'acme', session_id: 'sess-1', contact: { name: 'Max Muster', email: 'max@example.com' } }),
    { createAdminClient: fakeAdminClient(c) as never, complete: cannedComplete('unused') },
  )
  assertEquals(res.status, 200)
  const json = await res.json()
  assertEquals(json.show_booking, true)
  assertEquals(json.calendar_url, 'https://cal.com/acme')
  assertStringIncludes(json.reply, 'Termin')
  // Stored on the conversation + advanced the outcome.
  assertEquals(c.contactUpdate!.visitor_name, 'Max Muster')
  assertEquals(c.contactUpdate!.visitor_email, 'max@example.com')
  assertEquals(c.outcomeUpdate, 'booking_shown')
  // The contact is logged to the transcript so the coach sees it.
  assertStringIncludes(c.insertedMessages[0].content as string, 'max@example.com')
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

Deno.test('answering the last criterion returns no quick_replies and a disqualifying answer sets qualified false', async () => {
  const c = makeCaptured()
  c.conciergeRow!.qualification_criteria = [budgetCriterion]
  // Conversation already has the budget answered as qualifying; now answer... wait,
  // budget is the only criterion. Pre-seed a different prior answer so the new one
  // is the last and we can assert AND-rule disqualification.
  c.conciergeRow!.qualification_criteria = [timelineCriterion, budgetCriterion]
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
  // All criteria now answered -> no further prompt.
  assertEquals(json.quick_replies, undefined)
  // Completion must NOT stop at "thanks". With no contact yet it asks for name +
  // email first (the booking comes after the form, see the contact test).
  assertEquals(json.request_contact, true)
  assertEquals(json.show_booking, false)
  // AND-rule: one disqualifying answer makes the whole conversation not qualified.
  assertEquals(c.qualificationUpdate!.qualification_answers.length, 2)
  assertEquals(c.qualificationUpdate!.qualified, false)
})

Deno.test('answering the last criterion WHEN contact is on file goes straight to booking', async () => {
  const c = makeCaptured({
    existingConversation: {
      id: 'conv-x',
      outcome: 'open',
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
  assertEquals(json.show_booking, true)
  assertEquals(json.calendar_url, 'https://cal.com/acme')
  assertStringIncludes(json.reply, 'Termin')
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
