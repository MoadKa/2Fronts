import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { verifyTwilioSignature } from '../_shared/twilioSignature.ts'

interface SmsWebhookDeps {
  verifySignature: (url: string, formParams: Record<string, string>, signatureHeader: string) => Promise<boolean> | boolean
  createAdminClient: () => SupabaseClient
}

const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!

const defaultDeps: SmsWebhookDeps = {
  verifySignature: (url, params, sig) => verifyTwilioSignature(url, params, sig, authToken),
  createAdminClient,
}

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

function isStop(body: string): boolean {
  return body.trim().toLowerCase() === 'stop'
}

export async function handleSmsWebhook(req: Request, deps: SmsWebhookDeps = defaultDeps): Promise<Response> {
  const bodyText = await req.text()
  const formParams = Object.fromEntries(new URLSearchParams(bodyText))
  const signature = req.headers.get('X-Twilio-Signature') ?? ''

  const validSignature = await deps.verifySignature(req.url, formParams, signature)
  if (!validSignature) {
    return new Response('Invalid signature', { status: 400 })
  }

  const to = formParams.To
  const from = formParams.From
  const messageBody = formParams.Body ?? ''

  const adminClient = deps.createAdminClient()
  const { data: provision } = await adminClient
    .from('automation_provisions')
    .select('id')
    .eq('twilio_phone_number', to)
    .maybeSingle()

  if (provision && isStop(messageBody)) {
    await adminClient
      .from('automation_provision_opt_outs')
      .insert({ provision_id: (provision as { id: string }).id, phone: from })
  }

  return new Response(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}

if (import.meta.main) {
  Deno.serve((req) => handleSmsWebhook(req))
}
