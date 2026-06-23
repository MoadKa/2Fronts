import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

// Postgres unique-violation. Raised when the email already exists (collides on
// the lower(email) unique index) — we translate this into a friendly
// "already on the list" rather than a 500.
const UNIQUE_VIOLATION = '23505'

const GENERIC_ERROR = 'Could not add you to the waitlist — please try again'

// Pragmatic email shape check: a non-empty local part, an @, a domain with a
// dot, and no spaces. We deliberately keep this loose (RFC-perfect validation
// is famously hard and rejects valid addresses); the real proof is whether the
// confirmation/launch email ever lands.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface InsertResult {
  // duplicate is the "already subscribed" case: not an error, no new row.
  duplicate: boolean
}

export interface WaitlistDeps {
  insertSignup: (row: { email: string; locale: string | null; source: string | null }) => Promise<InsertResult>
}

async function defaultInsertSignup(row: { email: string; locale: string | null; source: string | null }): Promise<InsertResult> {
  const supabase = createAdminClient()
  const { error }: { error: { code?: string } | null } = await supabase.from('waitlist_signups').insert(row)
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { duplicate: true }
    throw error
  }
  return { duplicate: false }
}

const defaultDeps: WaitlistDeps = {
  insertSignup: defaultInsertSignup,
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export async function handleWaitlistSignup(req: Request, deps: WaitlistDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  let body: { email?: unknown; locale?: unknown; source?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400)
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (email === '' || !EMAIL_RE.test(email)) {
    return jsonResponse({ error: 'A valid email is required' }, 400)
  }

  const locale = typeof body.locale === 'string' && body.locale.trim() !== '' ? body.locale.trim() : null
  const source = typeof body.source === 'string' && body.source.trim() !== '' ? body.source.trim() : null

  try {
    const { duplicate } = await deps.insertSignup({ email, locale, source })
    // Duplicate is a friendly success: the visitor is already on the list, so we
    // return 200 with an `alreadySubscribed` flag the client can surface.
    return jsonResponse({ ok: true, alreadySubscribed: duplicate }, 200)
  } catch (err) {
    console.error('waitlist-signup: insert failed', err)
    return jsonResponse({ error: GENERIC_ERROR }, 500)
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleWaitlistSignup(req))
}
