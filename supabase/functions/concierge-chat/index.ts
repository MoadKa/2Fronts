// concierge-chat: the public runtime of the AI Booking Concierge (#23).
//
// A visitor on /c/<slug> (no login) sends a message; this function answers as
// the coach's AI, grounded ONLY in the coach's offer/qa, and books the call.
//
// It is PUBLIC (deploy with --no-verify-jwt) but reads everything through the
// admin client: the coach's offer_description and qa are private knowledge and
// must NEVER reach the browser, so there is no client-side read of the
// concierges table (RLS forbids it). Only the AI's reply + the calendar link on
// booking intent come back.
//
// All external effects are injected (admin client + the LLM complete()) so the
// handler is unit-tested offline with canned replies, exactly like intake and
// slack-configure.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import {
  type ChatCompleteFn,
  type ChatTurn,
  type ClassifyAnswerFn,
  type ConciergeKnowledge,
  createClassifyAnswer,
  createGeminiChatComplete,
  generateConciergeReply,
} from '../_shared/conciergeChat.ts'
import {
  type QualAnswer,
  type QualCriterion,
  type QualPrompt,
  evaluateQualified,
  nextUnansweredCriterion,
} from '../_shared/qualification.ts'

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// How many recent turns of history we feed the model. Keeps the prompt bounded
// and cost predictable; older context rarely changes the next reply.
const HISTORY_LIMIT = 20

export interface ConciergeChatDeps {
  createAdminClient: () => SupabaseClient
  // Injectable LLM call. Defaults to the real Gemini multi-turn client, built
  // lazily so a missing key only errors a real request, never a CORS preflight.
  complete?: ChatCompleteFn
  // Injectable per-key rate limiter (true = allowed). Defaults to the DB-backed
  // fixed-window limiter; tests inject a stub to assert the 429 path.
  checkRateLimit?: (key: string) => Promise<boolean>
  // Injectable free-text qualification classifier (v1.3). When a quick-reply
  // question is pending and the visitor TYPES instead of tapping, this interprets
  // their text against that criterion. Defaults to a tiny Gemini classification
  // call built from `complete`; tests inject a stub so they stay offline.
  classifyAnswer?: ClassifyAnswerFn
}

const defaultDeps: ConciergeChatDeps = {
  createAdminClient,
}

// Public, no-JWT endpoint: cap requests per client IP so a script can't run up
// the Gemini bill. Fixed window, enforced in Postgres so the count holds across
// the stateless edge isolates. Generous enough a real visitor never hits it.
const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_SECS = 60

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

// DB-backed fixed-window limiter. Fail-OPEN on any error (no rpc in unit tests,
// transient DB issue): a limiter glitch must never block a real booking. The
// happy path still limits abusers.
async function dbRateLimit(admin: SupabaseClient, key: string): Promise<boolean> {
  try {
    if (typeof (admin as { rpc?: unknown }).rpc !== 'function') return true
    const { data, error } = await admin.rpc('concierge_rate_limit_hit', {
      p_key: key,
      p_max: RATE_LIMIT_MAX,
      p_window_secs: RATE_LIMIT_WINDOW_SECS,
    })
    if (error) return true
    return data !== false
  } catch {
    return true
  }
}

interface ConciergeRow extends ConciergeKnowledge {
  id: string
}

// A QualCriterion is structurally a QualPrompt (criterion_id alias is the id).
function toQualPrompt(c: QualCriterion): QualPrompt {
  return { criterion_id: c.id, question: c.question, options: c.options }
}

type Lang = ConciergeKnowledge['language']

// The conversation runs a controlled flow tracked by concierge_conversations.phase:
//   contact -> intro_gate -> (answering_intro) -> qualifying
//           -> final_gate -> (answering_final) -> booking
// The two Yes/No gates and the "no more questions" exit are rendered with the
// existing quick-reply mechanism, using these RESERVED control criterion ids so
// the client needs no change. They are intercepted before qualification, so they
// never land in qualification_answers (real ids are budget/…/custom_<n>).
const CONTROL = {
  intro: '__intro_gate__',
  final: '__final_gate__',
  done: '__done_questions__',
} as const

function isControlId(id: string): boolean {
  return id === CONTROL.intro || id === CONTROL.final || id === CONTROL.done
}

// Short localized acknowledgement returned when the visitor clicks a quick-reply
// button (no model call that turn). Mirrors the de/en split used elsewhere.
function answerAck(language: Lang): string {
  return language === 'en' ? 'Thanks!' : 'Danke!'
}

// The greeting shown the moment the visitor hands over name + email: greet by
// name, then immediately ask the FIRST gate — do you have questions before we
// start? — so the flow always offers help before it qualifies.
function introGreeting(language: Lang, name: string): string {
  return language === 'en'
    ? `Thanks, ${name}! Before we start, do you have any questions for me?`
    : `Danke, ${name}! Bevor wir starten: Hast du noch Fragen an mich?`
}

// The final gate, asked once qualification is done and right before the booking
// link: make sure nothing is left open before we hand over the calendar.
function finalGateQuestion(language: Lang): string {
  return language === 'en'
    ? 'Great. Before I send you the booking link, do you have any questions first?'
    : 'Alles klar. Bevor ich dir den Termin schicke: Hast du vorher noch Fragen?'
}

// Said when the visitor opens the Q&A loop (tapped "Yes" on a gate): invite them
// to ask, and the page shows the "no more questions" exit button beneath it.
function askAway(language: Lang): string {
  return language === 'en'
    ? "Sure, ask away. I'll answer what I can."
    : 'Klar, frag einfach. Ich beantworte dir, was ich kann.'
}

// The Yes/No gate rendered before qualification. `qualifies:true` encodes "Yes,
// I have questions" so the handler can branch on the clicked option.
function introGatePrompt(language: Lang): QualPrompt {
  return {
    criterion_id: CONTROL.intro,
    question: introGateQuestionText(language),
    options: language === 'en'
      ? [{ label: 'Yes, I have a question', qualifies: true }, { label: "No, let's get started", qualifies: false }]
      : [{ label: 'Ja, ich habe Fragen', qualifies: true }, { label: 'Nein, lass uns loslegen', qualifies: false }],
  }
}

function introGateQuestionText(language: Lang): string {
  return language === 'en' ? 'Do you have any questions for me?' : 'Hast du noch Fragen an mich?'
}

// The Yes/No gate rendered right before the booking link. Same encoding as the
// intro gate; distinct id so the handler knows which stage it is at.
function finalGatePrompt(language: Lang): QualPrompt {
  return {
    criterion_id: CONTROL.final,
    question: finalGateQuestion(language),
    options: language === 'en'
      ? [{ label: 'Yes, one more', qualifies: true }, { label: "No, I'm all set", qualifies: false }]
      : [{ label: 'Ja, eine noch', qualifies: true }, { label: 'Nein, alles klar', qualifies: false }],
  }
}

// The single exit button shown throughout a Q&A loop: tapping it ends the loop
// and moves the flow forward (to qualification, or to booking).
function doneButtonPrompt(language: Lang): QualPrompt {
  return {
    criterion_id: CONTROL.done,
    question: '',
    options: [{ label: language === 'en' ? 'I have no more questions' : 'Ich habe keine Fragen mehr', qualifies: false }],
  }
}

// Said when the visitor finishes the qualifying questions via buttons (no model
// call that turn). The bot must NOT just stop at "thanks": it invites the booking
// (hybrid model = everyone who finishes is invited; the `qualified` flag is only
// for the coach's tagging). The page shows the booking button off `show_booking`.
function bookingInvite(language: ConciergeKnowledge['language']): string {
  return language === 'en'
    ? "Thanks! Based on that, the best next step is a quick call. Grab a time that works for you right here:"
    : 'Danke! Auf der Basis ist der beste nächste Schritt ein kurzes Gespräch. Schnapp dir hier direkt einen passenden Termin:'
}

// Asked once, right before the booking link, so the coach ALWAYS gets a name +
// email for a lead who reaches the booking step. The bot stays in character and
// leads; the page renders name + email fields under this message.
function contactRequest(language: ConciergeKnowledge['language']): string {
  return language === 'en'
    ? 'Perfect! So we can set everything up for you and confirm your spot — what is your name, and the best email to reach you?'
    : 'Perfekt! Damit wir alles für dich vorbereiten und deinen Platz bestätigen können — wie heißt du, und unter welcher E-Mail erreichen wir dich am besten?'
}

// The visitor's typed contact details, submitted from the name/email form. Both
// required; email is lightly validated so a coach never gets an obviously bogus
// address. Returns null when malformed so we fall back to the normal flow.
interface VisitorContact {
  name: string
  email: string
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function parseContact(raw: unknown): VisitorContact | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  const name = typeof c.name === 'string' ? c.name.trim() : ''
  const email = typeof c.email === 'string' ? c.email.trim() : ''
  if (!name || name.length > 200 || !email || email.length > 320 || !isEmail(email)) return null
  return { name, email }
}

// Validate an inbound quick-reply answer from the public body. Returns null when
// it isn't a well-formed QualAnswer so we fall back to the normal text flow.
function parseAnswer(raw: unknown): QualAnswer | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  if (typeof a.criterion_id !== 'string' || typeof a.label !== 'string' || typeof a.qualifies !== 'boolean') {
    return null
  }
  return { criterion_id: a.criterion_id, label: a.label, qualifies: a.qualifies }
}

// A 200 JSON response with the standard headers. Keeps the transition helpers
// below terse and consistent.
function ok(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: jsonHeaders })
}

// Insert conversation turns (skips the write when there is nothing to log).
async function logTurns(
  admin: SupabaseClient,
  conversationId: string,
  turns: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<void> {
  if (turns.length === 0) return
  await admin
    .from('concierge_messages')
    .insert(turns.map((t) => ({ conversation_id: conversationId, role: t.role, content: t.content })))
}

// Enter (or stay in) a free-type Q&A loop after the visitor tapped "Yes" on a
// gate. Sets the phase, logs the clicked label + the invite, and returns the
// single "no more questions" exit button. No model call.
async function enterQuestionLoop(
  admin: SupabaseClient,
  conversationId: string,
  concierge: ConciergeRow,
  phase: 'answering_intro' | 'answering_final',
  userLabel: string,
): Promise<Response> {
  await admin.from('concierge_conversations').update({ phase }).eq('id', conversationId)
  const reply = askAway(concierge.language)
  await logTurns(admin, conversationId, [
    { role: 'user', content: userLabel },
    { role: 'assistant', content: reply },
  ])
  return ok({ reply, show_booking: false, quick_replies: doneButtonPrompt(concierge.language) })
}

// Reveal the booking link: mark the conversation booking-shown and hand over the
// calendar. `userLabel` (a clicked control label) is logged as a user turn when
// present. This is the ONLY deterministic path that sets show_booking.
async function revealBooking(
  admin: SupabaseClient,
  conversationId: string,
  concierge: ConciergeRow,
  userLabel?: string,
): Promise<Response> {
  await admin
    .from('concierge_conversations')
    .update({ phase: 'booking', outcome: 'booking_shown' })
    .eq('id', conversationId)
  const reply = bookingInvite(concierge.language)
  await logTurns(admin, conversationId, [
    ...(userLabel ? [{ role: 'user' as const, content: userLabel }] : []),
    { role: 'assistant', content: reply },
  ])
  return ok({ reply, show_booking: true, calendar_url: concierge.calendar_url })
}

// Open the final Yes/No gate ("any questions before the link?"). Optionally logs
// a preceding user turn (e.g. the last qualification answer's label).
async function openFinalGate(
  admin: SupabaseClient,
  conversationId: string,
  concierge: ConciergeRow,
  userLabel?: string,
): Promise<Response> {
  await admin.from('concierge_conversations').update({ phase: 'final_gate' }).eq('id', conversationId)
  const reply = finalGateQuestion(concierge.language)
  await logTurns(admin, conversationId, [
    ...(userLabel ? [{ role: 'user' as const, content: userLabel }] : []),
    { role: 'assistant', content: reply },
  ])
  return ok({ reply, show_booking: false, quick_replies: finalGatePrompt(concierge.language) })
}

// Leave the intro questions stage (gate "No", or the exit button in
// answering_intro) and move the flow forward: ask the first qualifying criterion
// when any remain, otherwise (no criteria) reveal the booking link.
async function advancePastIntroQuestions(
  admin: SupabaseClient,
  conversationId: string,
  concierge: ConciergeRow,
  criteria: QualCriterion[],
  priorAnswers: QualAnswer[],
  userLabel: string,
): Promise<Response> {
  const next = nextUnansweredCriterion(criteria, priorAnswers)
  if (!next) return revealBooking(admin, conversationId, concierge, userLabel)
  await admin.from('concierge_conversations').update({ phase: 'qualifying' }).eq('id', conversationId)
  const reply = `${answerAck(concierge.language)} ${next.question}`
  await logTurns(admin, conversationId, [
    { role: 'user', content: userLabel },
    { role: 'assistant', content: reply },
  ])
  return ok({ reply, show_booking: false, quick_replies: toQualPrompt(next) })
}

export async function handleConciergeChat(req: Request, deps: ConciergeChatDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: jsonHeaders })
  }

  let body: {
    slug?: unknown
    session_id?: unknown
    message?: unknown
    answer?: unknown
    pending_criterion_id?: unknown
    contact?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: jsonHeaders })
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  // A clicked quick-reply button: the visitor's qualification answer. When present
  // and valid we record it deterministically and skip the model for this turn.
  const answer = parseAnswer(body.answer)
  // The visitor TYPED free text while this criterion's quick-reply question was
  // pending. We classify the text against that criterion instead of ignoring it.
  const pendingCriterionId =
    typeof body.pending_criterion_id === 'string' ? body.pending_criterion_id.trim() : ''
  // A submission from the name/email form. When present + valid we store it and
  // move straight to the booking, so `message` is not required on this turn.
  const contact = parseContact(body.contact)
  if (!slug || !sessionId || (!message && !contact)) {
    return new Response(JSON.stringify({ error: 'slug, session_id and message are required' }), { status: 400, headers: jsonHeaders })
  }
  // Bound public input: this endpoint takes no JWT, so unbounded message/session
  // text would burn Gemini tokens and bloat the DB on abuse. Cap both early.
  if (message.length > 2000) {
    return new Response(JSON.stringify({ error: 'message_too_long' }), { status: 400, headers: jsonHeaders })
  }
  if (sessionId.length > 256) {
    return new Response(JSON.stringify({ error: 'session_id_too_long' }), { status: 400, headers: jsonHeaders })
  }

  const admin = deps.createAdminClient()

  // Rate-limit by client IP BEFORE any expensive work (concierge load + Gemini
  // call). Public endpoint with no JWT, so this is the only spend guard.
  const limiter = deps.checkRateLimit ?? ((key: string) => dbRateLimit(admin, key))
  if (!(await limiter(`ip:${clientIp(req)}`))) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: jsonHeaders })
  }

  // 1. Load the active concierge by slug, server-side. 404 if missing/inactive
  //    so an unknown or paused link gets a friendly "not available", never a
  //    crash — and we never even build a prompt for a concierge that isn't live.
  const { data: conciergeData, error: conciergeErr } = await admin
    .from('concierges')
    .select('id, business_name, offer_description, qa, tone, language, calendar_url, qualification_criteria')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()
  if (conciergeErr || !conciergeData) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: jsonHeaders })
  }
  const concierge = conciergeData as ConciergeRow
  // Default to no criteria when the column is null (older rows / not configured).
  const criteria: QualCriterion[] = Array.isArray(concierge.qualification_criteria)
    ? concierge.qualification_criteria
    : []
  // The coach's knowledge as the reply generator needs it (offer/qa never leave
  // the server). Built once and reused by every model-backed path below.
  const knowledge: ConciergeKnowledge = {
    business_name: concierge.business_name,
    offer_description: concierge.offer_description,
    qa: concierge.qa,
    tone: concierge.tone,
    language: concierge.language,
    calendar_url: concierge.calendar_url,
    qualification_criteria: criteria,
  }

  try {
    // 2. Find (or open) this visitor's conversation for the concierge, and load
    //    its recorded qualification answers + the flow phase (so we resume the
    //    right step on this turn).
    const { id: conversationId, qualification_answers: priorAnswers, visitor_email, phase } =
      await resolveConversation(admin, concierge.id, sessionId)
    const hasContact = Boolean(visitor_email)

    // 2a. CONTACT BRANCH. The visitor submitted the name/email form — the OPENING
    //     step. Store the contact (so the coach always has the lead), log it, then
    //     open the flow at the FIRST question gate: greet by name and ask whether
    //     they have questions before we start. No model call this turn.
    if (contact) {
      await admin
        .from('concierge_conversations')
        .update({ visitor_name: contact.name, visitor_email: contact.email, phase: 'intro_gate' })
        .eq('id', conversationId)
      const reply = introGreeting(concierge.language, contact.name)
      await logTurns(admin, conversationId, [
        { role: 'user', content: `${contact.name} · ${contact.email}` },
        { role: 'assistant', content: reply },
      ])
      return ok({ reply, show_booking: false, quick_replies: introGatePrompt(concierge.language) })
    }

    // 2b. CONTROL-BUTTON BRANCH. The visitor tapped a flow-control button (a Yes/No
    //     gate, or the "no more questions" exit). These drive the phase machine and
    //     never touch qualification_answers. Guarded by phase so a stale/out-of-band
    //     click just falls through to normal handling. No model call.
    if (answer && isControlId(answer.criterion_id)) {
      // Intro gate: "any questions before we start?"
      if (answer.criterion_id === CONTROL.intro && phase === 'intro_gate') {
        return answer.qualifies
          ? await enterQuestionLoop(admin, conversationId, concierge, 'answering_intro', answer.label)
          : await advancePastIntroQuestions(admin, conversationId, concierge, criteria, priorAnswers, answer.label)
      }
      // Final gate: "any questions before I send the link?"
      if (answer.criterion_id === CONTROL.final && phase === 'final_gate') {
        return answer.qualifies
          ? await enterQuestionLoop(admin, conversationId, concierge, 'answering_final', answer.label)
          : await revealBooking(admin, conversationId, concierge, answer.label)
      }
      // Exit button: leave the Q&A loop and move forward from where it was opened.
      // Guarded to the answering phases like the two gates above, so a stale or
      // spoofed exit click at any other phase can never jump the flow forward or
      // reveal the booking link (a no-criteria concierge would otherwise book on
      // the very first request, skipping contact capture and both gates).
      if (answer.criterion_id === CONTROL.done && (phase === 'answering_intro' || phase === 'answering_final')) {
        return phase === 'answering_final'
          ? await revealBooking(admin, conversationId, concierge, answer.label)
          : await advancePastIntroQuestions(admin, conversationId, concierge, criteria, priorAnswers, answer.label)
      }
      // Control id but phase does not match: fall through (treated as free text).
    }

    // 2c. QUALIFICATION QUICK-REPLY BRANCH. The visitor clicked a real qualifying
    //     button: record the answer, recompute `qualified`, log the label, and ask
    //     the NEXT criterion — or, when qualification is complete, open the FINAL
    //     gate (contact was captured at the start, so we never stop for it here).
    //     No model call. Control ids are excluded: one that reached here fell
    //     through the phase-guarded block above (stale/out-of-band click), so it
    //     must NOT be recorded as a qualification answer — let it fall to the
    //     normal reply path (which is contact-gated) instead.
    if (answer && !isControlId(answer.criterion_id)) {
      const updatedAnswers: QualAnswer[] = [...priorAnswers, answer]
      const qualified = evaluateQualified(updatedAnswers)
      await admin
        .from('concierge_conversations')
        .update({ qualification_answers: updatedAnswers, qualified })
        .eq('id', conversationId)
      await admin
        .from('concierge_messages')
        .insert([{ conversation_id: conversationId, role: 'user', content: answer.label }])

      const next = nextUnansweredCriterion(criteria, updatedAnswers)
      if (next) {
        // Another criterion remains: ack + ask it, so the text above the next set
        // of buttons reads as the bot asking it (not a stray label).
        const reply = `${answerAck(concierge.language)} ${next.question}`
        await admin
          .from('concierge_messages')
          .insert([{ conversation_id: conversationId, role: 'assistant', content: reply }])
        await admin.from('concierge_conversations').update({ phase: 'qualifying' }).eq('id', conversationId)
        return ok({ reply, show_booking: false, quick_replies: toQualPrompt(next) })
      }
      // Qualification COMPLETE: ask once more before the link (the user label was
      // already logged just above, so don't log it twice).
      return await openFinalGate(admin, conversationId, concierge)
    }

    // 3. Load only the most recent HISTORY_LIMIT turns (newest-first in the DB),
    //    then reverse to oldest-first so the prompt reads chronologically. Fetching
    //    with a limit avoids pulling an unbounded thread just to slice it later.
    const { data: historyData } = await admin
      .from('concierge_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    const history = ((historyData ?? []) as ChatTurn[]).reverse()

    const complete = deps.complete ?? createGeminiChatComplete()

    // A grounded answer to the visitor's message with NO pending criterion — used
    // by the Q&A loop, where the message is always a plain question.
    const groundedAnswer = async (): Promise<string> => {
      const r = await generateConciergeReply({ concierge: knowledge, history, message, pendingCriterion: null }, { complete })
      return r.reply
    }

    // 3a. Q&A LOOP. In an answering_* phase every typed message is a QUESTION:
    //     answer it grounded, keep the booking link suppressed (we only reveal it
    //     at the very end of the flow), and re-show the "no more questions" exit
    //     button so the visitor can leave the loop when satisfied. Any
    //     pending_criterion_id is irrelevant here (there is no pending criterion).
    if (phase === 'answering_intro' || phase === 'answering_final') {
      const reply = await groundedAnswer()
      await logTurns(admin, conversationId, [
        { role: 'user', content: message },
        { role: 'assistant', content: reply },
      ])
      return ok({ reply, show_booking: false, quick_replies: doneButtonPrompt(concierge.language) })
    }

    // 3a-bis. GATE, TYPED. The visitor typed instead of tapping Yes/No at a gate —
    //     which means they DO have a question. Enter the matching Q&A loop and
    //     answer it, then show the exit button.
    if (phase === 'intro_gate' || phase === 'final_gate') {
      const nextPhase = phase === 'final_gate' ? 'answering_final' : 'answering_intro'
      await admin.from('concierge_conversations').update({ phase: nextPhase }).eq('id', conversationId)
      const reply = await groundedAnswer()
      await logTurns(admin, conversationId, [
        { role: 'user', content: message },
        { role: 'assistant', content: reply },
      ])
      return ok({ reply, show_booking: false, quick_replies: doneButtonPrompt(concierge.language) })
    }

    // 3b. FREE-TEXT QUALIFICATION (v1.3). The visitor TYPED while a quick-reply
    //     question was pending. Interpret the text against that criterion so a
    //     typed answer is never silently dropped (the old bug: the same criterion
    //     was re-attached and the buttons never cleared). The LLM classifier
    //     decides: matched option, OTHER (answered off-menu), or NONE (not an
    //     answer — a real question). We only record when it's an actual answer.
    let workingAnswers: QualAnswer[] = priorAnswers
    if (pendingCriterionId) {
      const pending = criteria.find((c) => c.id === pendingCriterionId)
      const alreadyAnswered = priorAnswers.some((a) => a.criterion_id === pendingCriterionId)
      if (pending && !alreadyAnswered) {
        const classify = deps.classifyAnswer ?? createClassifyAnswer(complete)
        const verdict = await classify(pending, message)
        if (verdict.kind === 'matched') {
          // The typed text maps to a real option: record it with the VERBATIM user
          // text as the label, but the option's qualifies value.
          workingAnswers = [
            ...priorAnswers,
            { criterion_id: pending.id, label: message, qualifies: verdict.option.qualifies },
          ]
        } else if (verdict.kind === 'other') {
          // An answer, but off-menu -> record it as non-qualifying and advance.
          workingAnswers = [
            ...priorAnswers,
            { criterion_id: pending.id, label: message, qualifies: false },
          ]
        }
        // NONE -> not an answer; leave the criterion pending (do not record).
        if (workingAnswers !== priorAnswers) {
          const qualified = evaluateQualified(workingAnswers)
          await admin
            .from('concierge_conversations')
            .update({ qualification_answers: workingAnswers, qualified })
            .eq('id', conversationId)
        }
      }
    }

    // 4. Generate the grounded reply. The LLM client is built lazily so the key
    //    is only required when we actually call the model. The next unanswered
    //    criterion (if any) is passed in so the BOT asks it in its own words —
    //    the buttons below are just the answer options. This keeps the reply text
    //    and the buttons coherent (the bot leads), instead of bolting a stray
    //    question onto an unrelated reply. After a typed answer was recorded the
    //    "next" advances; after NONE it re-asks the same still-pending criterion.
    const next = nextUnansweredCriterion(criteria, workingAnswers)

    // 3c. During QUALIFYING, a typed message that COMPLETED the criteria (its last
    //     answer was just recorded above) advances the flow to the final gate — we
    //     never let the model jump to booking mid-flow. Log the visitor's message,
    //     then ask once more before the link.
    if (phase === 'qualifying' && !next) {
      return await openFinalGate(admin, conversationId, concierge, message)
    }

    // 4. Generate the grounded reply. The LLM client is built lazily so the key is
    //    only required when we actually call the model. The next unanswered
    //    criterion (if any) is passed in so the BOT asks it in its own words — the
    //    buttons below are just the answer options.
    const result = await generateConciergeReply(
      { concierge: knowledge, history, message, pendingCriterion: next },
      { complete },
    )

    // Booking is only ever revealed at the very end of the flow. While we are still
    // qualifying, suppress any link the model may have surfaced (e.g. an honest
    // "can't answer that — book a call" fallback) so the controlled flow holds.
    const showBooking = phase === 'qualifying' ? false : result.show_booking

    // 5. Gate booking behind contact: if the model wants to surface the booking
    //    link but we have no name/email yet, ask for it first (the page renders the
    //    contact form). The lead only ever reaches the booking after we have it.
    if (showBooking && !hasContact) {
      const reply = contactRequest(concierge.language)
      await admin.from('concierge_messages').insert([
        { conversation_id: conversationId, role: 'user', content: message },
        { conversation_id: conversationId, role: 'assistant', content: reply },
      ])
      return ok({ reply, show_booking: false, request_contact: true })
    }

    // 5b. Persist both turns (user first, then assistant) and, when the reply
    //     surfaced the booking link, advance the conversation phase + outcome.
    await admin.from('concierge_messages').insert([
      { conversation_id: conversationId, role: 'user', content: message },
      { conversation_id: conversationId, role: 'assistant', content: result.reply },
    ])
    if (showBooking) {
      await admin
        .from('concierge_conversations')
        .update({ outcome: 'booking_shown', phase: 'booking' })
        .eq('id', conversationId)
    }

    // 6. Return only the reply + booking signal. The bot already asked `next` in
    //    its reply (step 4); we attach its options as quick-reply buttons. Offer/qa
    //    never leave the server.
    return ok({
      reply: result.reply,
      show_booking: showBooking,
      ...(showBooking && result.calendar_url ? { calendar_url: result.calendar_url } : {}),
      ...(next ? { quick_replies: toQualPrompt(next) } : {}),
    })
  } catch (e) {
    const messageText = e instanceof Error ? e.message : 'concierge_chat_failed'
    console.error('concierge-chat:', messageText)
    return new Response(JSON.stringify({ error: 'concierge_chat_failed' }), { status: 502, headers: jsonHeaders })
  }
}

// Reuse an existing conversation for this (concierge, session) when one exists,
// else open a new one. Keeping one conversation per session means the AI sees
// the visitor's whole thread, not a fresh start each message.
//
// Race-safe: a UNIQUE (concierge_id, visitor_session_id) constraint makes the
// upsert atomic. We upsert with ignoreDuplicates so a brand-new session inserts
// (and returns) its row, while concurrent requests for an existing session hit
// the conflict and get NO row back — without ever overwriting the live outcome.
// On that empty result we SELECT the existing row by the same key. Returns the id
// plus the conversation's recorded qualification answers (empty for a new row).
interface ResolvedConversation {
  id: string
  qualification_answers: QualAnswer[]
  // Set once the visitor submitted the contact form; lets us gate the booking so
  // it is only shown after we have a name + email for the lead.
  visitor_email: string | null
  // The flow step this conversation is at. Defaults to 'contact' for a brand-new
  // row (and older rows), so the flow always starts by capturing name + email.
  phase: string
}

function toAnswers(raw: unknown): QualAnswer[] {
  return Array.isArray(raw) ? (raw as QualAnswer[]) : []
}

type ConvRow =
  | { id?: string; qualification_answers?: unknown; visitor_email?: unknown; phase?: unknown }
  | null

function toResolved(row: ConvRow): ResolvedConversation | null {
  if (!row?.id) return null
  return {
    id: row.id,
    qualification_answers: toAnswers(row.qualification_answers),
    visitor_email: typeof row.visitor_email === 'string' ? row.visitor_email : null,
    phase: typeof row.phase === 'string' ? row.phase : 'contact',
  }
}

async function resolveConversation(
  admin: SupabaseClient,
  conciergeId: string,
  sessionId: string,
): Promise<ResolvedConversation> {
  const { data: upserted } = await admin
    .from('concierge_conversations')
    .upsert(
      { concierge_id: conciergeId, visitor_session_id: sessionId, outcome: 'open' },
      { onConflict: 'concierge_id,visitor_session_id', ignoreDuplicates: true },
    )
    .select('id, qualification_answers, visitor_email, phase')
    .maybeSingle()
  const up = toResolved(upserted as ConvRow)
  if (up) return up

  // Conflict path: the conversation already existed, so the upsert did nothing.
  // Read its id + answers + contact by the unique key.
  const { data: existing } = await admin
    .from('concierge_conversations')
    .select('id, qualification_answers, visitor_email, phase')
    .eq('concierge_id', conciergeId)
    .eq('visitor_session_id', sessionId)
    .maybeSingle()
  const ex = toResolved(existing as ConvRow)
  if (ex) return ex

  throw new Error('could not open conversation')
}

if (import.meta.main) {
  Deno.serve((req) => handleConciergeChat(req))
}
