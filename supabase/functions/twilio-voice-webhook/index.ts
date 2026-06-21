import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { verifyTwilioSignature } from '../_shared/twilioSignature.ts'

export type SmsSender = (to: string, body: string) => Promise<void>

interface VoiceWebhookDeps {
  verifySignature: (url: string, formParams: Record<string, string>, signatureHeader: string) => Promise<boolean> | boolean
  createAdminClient: () => SupabaseClient
  sendSms: SmsSender
}

const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!

async function defaultSendSms(to: string, body: string): Promise<void> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const from = Deno.env.get('TWILIO_FROM_NUMBER')!
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  })
  if (!res.ok) throw new Error('Twilio SMS send failed')
}

const defaultDeps: VoiceWebhookDeps = {
  verifySignature: (url, params, sig) => verifyTwilioSignature(url, params, sig, authToken),
  createAdminClient,
  sendSms: defaultSendSms,
}

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

function buildMessage(businessName: string, bookingLink: string, businessHours: string | null): string {
  const hoursLine = businessHours ? ` Hours: ${businessHours}.` : ''
  return (
    `Sorry we missed your call! ${businessName} will text you back shortly. ` +
    `Book directly: ${bookingLink}.${hoursLine} ` +
    `This is an automated reply -- reply STOP to opt out, or call ${businessName} directly.`
  )
}

export async function handleVoiceWebhook(req: Request, deps: VoiceWebhookDeps = defaultDeps): Promise<Response> {
  const bodyText = await req.text()
  const formParams = Object.fromEntries(new URLSearchParams(bodyText))
  const signature = req.headers.get('X-Twilio-Signature') ?? ''

  const validSignature = await deps.verifySignature(req.url, formParams, signature)
  if (!validSignature) {
    return new Response('Invalid signature', { status: 400 })
  }

  const to = formParams.To
  const from = formParams.From
  if (!to || !from) {
    return new Response('Missing To or From', { status: 400 })
  }

  const adminClient = deps.createAdminClient()
  const { data: provision } = await adminClient
    .from('automation_provisions')
    .select('business_name, booking_link, business_hours, status')
    .eq('twilio_phone_number', to)
    .maybeSingle()

  if (provision) {
    const row = provision as { business_name: string; booking_link: string; business_hours: string | null }
    const message = buildMessage(row.business_name, row.booking_link, row.business_hours)
    try {
      await deps.sendSms(from, message)
    } catch {
      // Outbound SMS failed -- the voice call itself still needs a valid
      // TwiML response (Twilio can't retry the missed call), so this is
      // swallowed here. Send failures surface via normal function logs.
    }
  }

  return new Response(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}

if (import.meta.main) {
  Deno.serve(handleVoiceWebhook)
}
