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
  type ConciergeKnowledge,
  createGeminiChatComplete,
  generateConciergeReply,
} from '../_shared/conciergeChat.ts'

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// How many recent turns of history we feed the model. Keeps the prompt bounded
// and cost predictable; older context rarely changes the next reply.
const HISTORY_LIMIT = 20

export interface ConciergeChatDeps {
  createAdminClient: () => SupabaseClient
  // Injectable LLM call. Defaults to the real Gemini multi-turn client, built
  // lazily so a missing key only errors a real request, never a CORS preflight.
  complete?: ChatCompleteFn
}

const defaultDeps: ConciergeChatDeps = {
  createAdminClient,
}

interface ConciergeRow extends ConciergeKnowledge {
  id: string
}

export async function handleConciergeChat(req: Request, deps: ConciergeChatDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: jsonHeaders })
  }

  let body: { slug?: unknown; session_id?: unknown; message?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: jsonHeaders })
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!slug || !sessionId || !message) {
    return new Response(JSON.stringify({ error: 'slug, session_id and message are required' }), { status: 400, headers: jsonHeaders })
  }

  const admin = deps.createAdminClient()

  // 1. Load the active concierge by slug, server-side. 404 if missing/inactive
  //    so an unknown or paused link gets a friendly "not available", never a
  //    crash — and we never even build a prompt for a concierge that isn't live.
  const { data: conciergeData, error: conciergeErr } = await admin
    .from('concierges')
    .select('id, business_name, offer_description, qa, tone, language, calendar_url')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()
  if (conciergeErr || !conciergeData) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: jsonHeaders })
  }
  const concierge = conciergeData as ConciergeRow

  try {
    // 2. Find (or open) this visitor's conversation for the concierge.
    const conversationId = await resolveConversation(admin, concierge.id, sessionId)

    // 3. Load recent history for the conversation, oldest first.
    const { data: historyData } = await admin
      .from('concierge_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    const history = (historyData ?? []) as ChatTurn[]

    // 4. Generate the grounded reply. The LLM client is built lazily so the key
    //    is only required when we actually call the model.
    const complete = deps.complete ?? createGeminiChatComplete()
    const result = await generateConciergeReply(
      {
        concierge: {
          business_name: concierge.business_name,
          offer_description: concierge.offer_description,
          qa: concierge.qa,
          tone: concierge.tone,
          language: concierge.language,
          calendar_url: concierge.calendar_url,
        },
        history: history.slice(-HISTORY_LIMIT),
        message,
      },
      { complete },
    )

    // 5. Persist both turns (user first, then assistant) and, when the reply
    //    surfaced the booking link, advance the conversation outcome.
    await admin.from('concierge_messages').insert([
      { conversation_id: conversationId, role: 'user', content: message },
      { conversation_id: conversationId, role: 'assistant', content: result.reply },
    ])
    if (result.show_booking) {
      await admin.from('concierge_conversations').update({ outcome: 'booking_shown' }).eq('id', conversationId)
    }

    // 6. Return only the reply + booking signal. Offer/qa never leave the server.
    return new Response(
      JSON.stringify({
        reply: result.reply,
        show_booking: result.show_booking,
        ...(result.calendar_url ? { calendar_url: result.calendar_url } : {}),
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
async function resolveConversation(
  admin: SupabaseClient,
  conciergeId: string,
  sessionId: string,
): Promise<string> {
  const { data: existing } = await admin
    .from('concierge_conversations')
    .select('id')
    .eq('concierge_id', conciergeId)
    .eq('visitor_session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
  const found = (existing ?? [])[0] as { id?: string } | undefined
  if (found?.id) return found.id

  const { data: created, error } = await admin
    .from('concierge_conversations')
    .insert({ concierge_id: conciergeId, visitor_session_id: sessionId, outcome: 'open' })
    .select()
    .single()
  if (error || !created) throw new Error('could not open conversation')
  return (created as { id: string }).id
}

if (import.meta.main) {
  Deno.serve((req) => handleConciergeChat(req))
}
