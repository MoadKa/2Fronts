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

// Injectable email transport + env reader so the notification unit-tests offline,
// mirroring notify-request. Returns true on a successful send.
export type SendEmailFn = (args: {
  apiKey: string
  from: string
  to: string | string[]
  subject: string
  text: string
}) => Promise<boolean>

const defaultSendEmail: SendEmailFn = async ({ apiKey, from, to, subject, text }) => {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
    })
    if (!res.ok) {
      console.error('submit-wish: resend responded', res.status)
      return false
    }
    return true
  } catch (e) {
    console.error('submit-wish: send failed', e instanceof Error ? e.message : 'unknown')
    return false
  }
}

const defaultEnv = (key: string): string | undefined => {
  try {
    return Deno.env.get(key)
  } catch {
    return undefined
  }
}

// Email the founder that a new automation suggestion came in. Best-effort: a
// no-op when Resend isn't configured (RESEND_API_KEY/ADMIN_EMAIL), and any error
// is swallowed so the wish is never lost just because the email failed.
async function notifyAdminOfWish(
  row: WishRow,
  sendEmail: SendEmailFn,
  env: (key: string) => string | undefined,
): Promise<void> {
  try {
    const apiKey = env('RESEND_API_KEY')
    const adminEmail = env('ADMIN_EMAIL')
    if (!apiKey || !adminEmail) return
    const from = env('RESEND_FROM') || '2Fronts <onboarding@resend.dev>'
    const text = [
      'Ein neuer Automatisierungs-Vorschlag ist eingegangen.',
      '',
      `Von: ${row.email}`,
      `Branche: ${row.industry || '(keine)'}`,
      `Vorschlag: ${row.message || '(kein Text)'}`,
    ].join('\n')
    // ADMIN_EMAIL may list several recipients, comma-separated (e.g. a 2fronts
    // address + a Gmail) so the founder can also see it in Google.
    const recipients = adminEmail.split(',').map((s) => s.trim()).filter(Boolean)
    await sendEmail({
      apiKey,
      from,
      to: recipients.length === 1 ? recipients[0] : recipients,
      subject: 'Neuer Automatisierungs-Vorschlag',
      text,
    })
  } catch (e) {
    console.error('submit-wish: notify failed', e instanceof Error ? e.message : 'unknown')
  }
}

export interface WishDeps {
  insertWish: (row: WishRow) => Promise<void>
  // Injectable for tests; default sends via Resend / reads real env.
  sendEmail?: SendEmailFn
  env?: (key: string) => string | undefined
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
    const row = { email, message, industry, locale, marketing_consent }
    await deps.insertWish(row)
    // Best-effort founder notification after the wish is safely stored.
    await notifyAdminOfWish(row, deps.sendEmail ?? defaultSendEmail, deps.env ?? defaultEnv)
    return jsonResponse({ ok: true }, 200)
  } catch (err) {
    console.error('submit-wish: insert failed', err)
    return jsonResponse({ error: GENERIC_ERROR }, 500)
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleSubmitWish(req))
}
