// notify-request: emails the founder when a customer requests an automation.
//
// `createRequest` (src/services/RequestService.ts) fires this best-effort after
// a successful insert, so the founder learns about a new request without polling
// the admin dashboard. It is PUBLIC-ish (deploy with --no-verify-jwt like the
// other public functions) but does nothing dangerous: it only sends one email to
// a FIXED, server-configured recipient (ADMIN_EMAIL) — the body fields are just
// trimmed/bounded text for the founder to read.
//
// GRACEFUL DEGRADATION is the whole point: before the founder sets up Resend
// (RESEND_API_KEY + ADMIN_EMAIL), this no-ops with { skipped: true } so requests
// keep working. And because the caller swallows errors, a send failure here can
// never block or fail a request — we even return 200 { sent: false } on a send
// error rather than a 5xx that could surface to the user.
//
// The actual HTTP call is injected (sendEmail) and env is injected (env) so the
// handler unit-tests fully offline, mirroring the other functions.

import { corsHeaders } from '../_shared/cors.ts'

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// Bound every field that lands in the email so an abusive caller can't build a
// giant payload or smuggle huge strings into the founder's inbox.
const MAX_NAME = 200
const MAX_EMAIL = 320
const MAX_ID = 100

export interface SendEmailArgs {
  apiKey: string
  from: string
  to: string
  subject: string
  text: string
}

// Injectable transport. Returns true on a successful send, false otherwise. The
// default uses fetch against Resend; tests inject a stub so they stay offline.
export type SendEmailFn = (args: SendEmailArgs) => Promise<boolean>

export interface NotifyRequestDeps {
  sendEmail?: SendEmailFn
  // Injectable env reader so tests never touch real Deno.env. Defaults to it.
  env?: (key: string) => string | undefined
}

// Real Resend transport. Never logs the API key. Any non-2xx or thrown error is
// reported as a failed send (false) so the handler can answer best-effort.
const defaultSendEmail: SendEmailFn = async ({ apiKey, from, to, subject, text }) => {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text }),
    })
    if (!res.ok) {
      console.error('notify-request: resend responded', res.status)
      return false
    }
    return true
  } catch (e) {
    console.error('notify-request: send failed', e instanceof Error ? e.message : 'unknown')
    return false
  }
}

const defaultEnv = (key: string): string | undefined => {
  // Deno.env may be unavailable in some contexts; never throw from reading env.
  try {
    return Deno.env.get(key)
  } catch {
    return undefined
  }
}

function str(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : ''
}

export async function handleNotifyRequest(req: Request, deps: NotifyRequestDeps = {}): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: jsonHeaders })
  }

  const env = deps.env ?? defaultEnv
  const sendEmail = deps.sendEmail ?? defaultSendEmail

  let body: { automation_name?: unknown; customer_email?: unknown; request_id?: unknown }
  try {
    body = await req.json()
  } catch {
    // A malformed body is not worth a 5xx — the notification is best-effort.
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: jsonHeaders })
  }

  const automationName = str(body.automation_name, MAX_NAME)
  const customerEmail = str(body.customer_email, MAX_EMAIL)
  const requestId = str(body.request_id, MAX_ID)

  const apiKey = env('RESEND_API_KEY')
  const adminEmail = env('ADMIN_EMAIL')

  // GRACEFUL NO-OP: before Resend is configured we must NOT call the API and must
  // NOT error — just report that we skipped, so requests keep flowing.
  if (!apiKey || !adminEmail) {
    return new Response(JSON.stringify({ skipped: true }), { status: 200, headers: jsonHeaders })
  }

  const from = env('RESEND_FROM') || '2Fronts <onboarding@resend.dev>'
  const nameForSubject = automationName || 'Automatisierung'
  const subject = `Neue Automatisierungs-Anfrage: ${nameForSubject}`
  const text = [
    'Eine neue Automatisierungs-Anfrage ist eingegangen.',
    '',
    `Automatisierung: ${automationName || '(unbekannt)'}`,
    `Kunde: ${customerEmail || '(unbekannt)'}`,
    `Anfrage-ID: ${requestId || '(unbekannt)'}`,
  ].join('\n')

  const sent = await sendEmail({ apiKey, from, to: adminEmail, subject, text })

  // Best-effort: even on a send failure we answer 200 so nothing ever surfaces a
  // 5xx to the caller (and thus the user). `sent` tells the truth for debugging.
  return new Response(JSON.stringify({ sent }), { status: 200, headers: jsonHeaders })
}

if (import.meta.main) {
  Deno.serve((req) => handleNotifyRequest(req))
}
