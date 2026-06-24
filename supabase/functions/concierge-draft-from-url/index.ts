// concierge-draft-from-url: the optional scrape accelerator for the onboarding
// wizard (#26).
//
// Authed (a signed-in coach only — no public access): given a URL and the
// concierge language, scrape the page and have Gemini draft a first concierge
// profile { offer_description, qa, tone, calendar_url? } the coach then edits in
// the wizard. This NEVER writes anything — it returns a draft only; the wizard
// still creates the concierges row via the existing path.
//
// It is an ACCELERATOR, never a gate: any failure returns a 502 the wizard
// catches to fall back to manual entry with no error wall. All external effects
// (auth, scrape, LLM) are injected so the handler is unit-tested offline.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import {
  type ConciergeDraftDeps,
  type ConciergeLanguage,
  createGeminiDraftComplete,
  defaultScrape,
  draftConciergeFromUrl,
} from '../_shared/conciergeDraft.ts'

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

export interface DraftFromUrlDeps {
  getUserId: (authHeader: string) => Promise<string | null>
  // The scrape+LLM orchestration deps, injected for offline tests. Built lazily
  // by default so a missing key only errors a real request, never a preflight.
  draftDeps?: ConciergeDraftDeps
}

async function defaultGetUserId(authHeader: string): Promise<string | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon || !authHeader) return null
  const client = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const { data } = await client.auth.getUser()
  return data.user?.id ?? null
}

const defaultDeps: DraftFromUrlDeps = {
  getUserId: defaultGetUserId,
}

function normaliseLanguage(v: unknown): ConciergeLanguage {
  return v === 'en' ? 'en' : 'de'
}

export async function handleDraftFromUrl(req: Request, deps: DraftFromUrlDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: jsonHeaders })
  }

  let body: { url?: unknown; language?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: jsonHeaders })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url || !/^https?:\/\//i.test(url)) {
    return new Response(JSON.stringify({ error: 'invalid_url' }), { status: 400, headers: jsonHeaders })
  }
  const language = normaliseLanguage(body.language)

  // Authed: only a signed-in coach may spend a scrape+LLM call.
  const uid = await deps.getUserId(req.headers.get('Authorization') ?? '')
  if (!uid) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  try {
    const draftDeps: ConciergeDraftDeps = deps.draftDeps ?? {
      scrape: (u) => defaultScrape(u),
      complete: createGeminiDraftComplete(),
    }
    const draft = await draftConciergeFromUrl(url, language, draftDeps)
    return new Response(JSON.stringify({ draft }), { status: 200, headers: jsonHeaders })
  } catch (e) {
    // Never leak internals; the wizard only needs to know "fall back to manual".
    const messageText = e instanceof Error ? e.message : 'draft_failed'
    console.error('concierge-draft-from-url:', messageText)
    return new Response(JSON.stringify({ error: 'draft_failed' }), { status: 502, headers: jsonHeaders })
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleDraftFromUrl(req))
}
