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

// Short localized acknowledgement returned when the visitor clicks a quick-reply
// button (no model call that turn). Mirrors the de/en split used elsewhere.
function answerAck(language: ConciergeKnowledge['language']): string {
  return language === 'en' ? 'Thanks!' : 'Danke!'
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

  try {
    // 2. Find (or open) this visitor's conversation for the concierge, and load
    //    its recorded qualification answers (so we can append + recompute).
    const { id: conversationId, qualification_answers: priorAnswers, visitor_email } =
      await resolveConversation(admin, concierge.id, sessionId)
    const hasContact = Boolean(visitor_email)

    // 2a. CONTACT BRANCH. The visitor submitted the name/email form. Store it on
    //     the conversation (so the coach always has the lead's contact), log it to
    //     the transcript, and move straight to the booking — this form only ever
    //     appears as the step right before booking. No model call this turn.
    if (contact) {
      await admin
        .from('concierge_conversations')
        .update({ visitor_name: contact.name, visitor_email: contact.email, outcome: 'booking_shown' })
        .eq('id', conversationId)
      const reply = bookingInvite(concierge.language)
      await admin.from('concierge_messages').insert([
        { conversation_id: conversationId, role: 'user', content: `${contact.name} · ${contact.email}` },
        { conversation_id: conversationId, role: 'assistant', content: reply },
      ])
      return new Response(
        JSON.stringify({ reply, show_booking: true, calendar_url: concierge.calendar_url }),
        { status: 200, headers: jsonHeaders },
      )
    }

    // 2b. QUICK-REPLY BRANCH. The visitor clicked a qualifying button: record the
    //     answer deterministically, recompute `qualified`, persist both, log the
    //     clicked label as a user message for history continuity, and return the
    //     NEXT question (if any). We do NOT call the model on this turn.
    if (answer) {
      const updatedAnswers: QualAnswer[] = [...priorAnswers, answer]
      const qualified = evaluateQualified(updatedAnswers)
      await admin
        .from('concierge_conversations')
        .update({ qualification_answers: updatedAnswers, qualified })
        .eq('id', conversationId)
      await admin
        .from('concierge_messages')
        .insert([{ conversation_id: conversationId, role: 'user', content: answer.label }])

      // No model call this turn, so build a coherent bot line ourselves.
      const next = nextUnansweredCriterion(criteria, updatedAnswers)
      if (next) {
        // Another criterion remains: ack + ask it, so the text above the next set
        // of buttons reads as the bot asking it (not a stray label).
        const reply = `${answerAck(concierge.language)} ${next.question}`
        await admin
          .from('concierge_messages')
          .insert([{ conversation_id: conversationId, role: 'assistant', content: reply }])
        return new Response(
          JSON.stringify({ reply, show_booking: false, quick_replies: toQualPrompt(next) }),
          { status: 200, headers: jsonHeaders },
        )
      }
      // Qualification COMPLETE on this click. Before the booking we must capture
      // the lead's contact: if we don't have it yet, ask for name + email (the
      // page shows the form); the booking comes after they submit it.
      if (!hasContact) {
        const reply = contactRequest(concierge.language)
        await admin
          .from('concierge_messages')
          .insert([{ conversation_id: conversationId, role: 'assistant', content: reply }])
        return new Response(
          JSON.stringify({ reply, show_booking: false, request_contact: true }),
          { status: 200, headers: jsonHeaders },
        )
      }
      // Contact already on file: do not stop at "thanks" — invite the booking and
      // surface the calendar link + button so the visitor can book now.
      const reply = bookingInvite(concierge.language)
      await admin
        .from('concierge_messages')
        .insert([{ conversation_id: conversationId, role: 'assistant', content: reply }])
      await admin
        .from('concierge_conversations')
        .update({ outcome: 'booking_shown' })
        .eq('id', conversationId)
      return new Response(
        JSON.stringify({ reply, show_booking: true, calendar_url: concierge.calendar_url }),
        { status: 200, headers: jsonHeaders },
      )
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
    const result = await generateConciergeReply(
      {
        concierge: {
          business_name: concierge.business_name,
          offer_description: concierge.offer_description,
          qa: concierge.qa,
          tone: concierge.tone,
          language: concierge.language,
          calendar_url: concierge.calendar_url,
          qualification_criteria: criteria,
        },
        history,
        message,
        pendingCriterion: next,
      },
      { complete },
    )

    // 5. Gate booking behind contact: if the model wants to surface the booking
    //    link but we have no name/email yet, ask for it first (the page renders the
    //    contact form). The lead only ever reaches the booking after we have it.
    if (result.show_booking && !hasContact) {
      const reply = contactRequest(concierge.language)
      await admin.from('concierge_messages').insert([
        { conversation_id: conversationId, role: 'user', content: message },
        { conversation_id: conversationId, role: 'assistant', content: reply },
      ])
      return new Response(
        JSON.stringify({ reply, show_booking: false, request_contact: true }),
        { status: 200, headers: jsonHeaders },
      )
    }

    // 5b. Persist both turns (user first, then assistant) and, when the reply
    //     surfaced the booking link, advance the conversation outcome.
    await admin.from('concierge_messages').insert([
      { conversation_id: conversationId, role: 'user', content: message },
      { conversation_id: conversationId, role: 'assistant', content: result.reply },
    ])
    if (result.show_booking) {
      await admin.from('concierge_conversations').update({ outcome: 'booking_shown' }).eq('id', conversationId)
    }

    // 6. Return only the reply + booking signal. The bot already asked `next` in
    //    its reply (step 4); we attach its options as quick-reply buttons. Offer/qa
    //    never leave the server.
    return new Response(
      JSON.stringify({
        reply: result.reply,
        show_booking: result.show_booking,
        ...(result.calendar_url ? { calendar_url: result.calendar_url } : {}),
        ...(next ? { quick_replies: toQualPrompt(next) } : {}),
      }),
      { status: 200, headers: jsonHeaders },
    )
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
}

function toAnswers(raw: unknown): QualAnswer[] {
  return Array.isArray(raw) ? (raw as QualAnswer[]) : []
}

type ConvRow = { id?: string; qualification_answers?: unknown; visitor_email?: unknown } | null

function toResolved(row: ConvRow): ResolvedConversation | null {
  if (!row?.id) return null
  return {
    id: row.id,
    qualification_answers: toAnswers(row.qualification_answers),
    visitor_email: typeof row.visitor_email === 'string' ? row.visitor_email : null,
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
    .select('id, qualification_answers, visitor_email')
    .maybeSingle()
  const up = toResolved(upserted as ConvRow)
  if (up) return up

  // Conflict path: the conversation already existed, so the upsert did nothing.
  // Read its id + answers + contact by the unique key.
  const { data: existing } = await admin
    .from('concierge_conversations')
    .select('id, qualification_answers, visitor_email')
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
