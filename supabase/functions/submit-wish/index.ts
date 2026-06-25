import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'

const GENERIC_ERROR = 'Could not submit your request — please try again'

// Pragmatic email shape check: a non-empty local part, an @, a domain with a
// dot, and no spaces. We deliberately keep this loose (RFC-perfect validation
// is famously hard and rejects valid addresses); the real proof is whether the
// confirmation/launch email ever lands.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface WishRow {
  email: string
  // Free-text "what are you missing?" from the catalog request form. Capped
  // before it reaches here.
  message: string | null
  // The selected industry (Branche), or null when left blank.
  industry: string | null
  locale: string | null
  // Explicit marketing opt-in (DSGVO active checkbox). The consent timestamp is
  // stamped at insert time in defaultInsertWish when this is true.
  marketing_consent: boolean
}

export interface WishDeps {
  insertWish: (row: WishRow) => Promise<void>
}

async function defaultInsertWish(row: WishRow): Promise<void> {
  const supabase = createAdminClient()
  const { error }: { error: { code?: string } | null } = await supabase
    .from('wishes')
    .insert({
      ...row,
      marketing_consent_at: row.marketing_consent ? new Date().toISOString() : null,
    })
  // No duplicate handling: unlike the waitlist there is no unique-email
  // constraint — every submission is its own row.
  if (error) throw error
}

const defaultDeps: WishDeps = {
  insertWish: defaultInsertWish,
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export async function handleSubmitWish(req: Request, deps: WishDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  let body: { email?: unknown; message?: unknown; industry?: unknown; locale?: unknown; marketing_consent?: unknown }
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
  // Bound the free-text request: public endpoint, so cap it like the concierge.
  const rawMessage = typeof body.message === 'string' ? body.message.trim() : ''
  const message = rawMessage === '' ? null : rawMessage.slice(0, 2000)
  const rawIndustry = typeof body.industry === 'string' ? body.industry.trim() : ''
  const industry = rawIndustry === '' ? null : rawIndustry
  const marketing_consent = body.marketing_consent === true

  try {
    await deps.insertWish({ email, message, industry, locale, marketing_consent })
    return jsonResponse({ ok: true }, 200)
  } catch (err) {
    console.error('submit-wish: insert failed', err)
    return jsonResponse({ error: GENERIC_ERROR }, 500)
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleSubmitWish(req))
}
