import { corsHeaders } from '../_shared/cors.ts'

interface CaptureDeps {
  getWebhookUrl: () => string | undefined
  fetchImpl: typeof fetch
}

const defaultDeps: CaptureDeps = {
  getWebhookUrl: () => Deno.env.get('MARKETPLACE_CAPTURE_WEBHOOK_URL'),
  fetchImpl: fetch,
}

const GENERIC_ERROR = 'Could not send your request — please try again'

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export async function handleMarketplaceCapture(req: Request, deps: CaptureDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const { email, business_name: businessName, automation_of_interest: automationOfInterest } = await req.json()

  if (typeof email !== 'string' || email.trim() === '') {
    return jsonResponse({ error: 'Email is required' }, 400)
  }
  if (typeof businessName !== 'string' || businessName.trim() === '') {
    return jsonResponse({ error: 'Business name is required' }, 400)
  }

  const webhookUrl = deps.getWebhookUrl()
  if (!webhookUrl) {
    console.error('marketplace-test-capture: MARKETPLACE_CAPTURE_WEBHOOK_URL is not configured')
    return jsonResponse({ error: GENERIC_ERROR }, 500)
  }

  const automationLine = typeof automationOfInterest === 'string' && automationOfInterest.trim() !== ''
    ? automationOfInterest
    : '(not specified)'
  const text = `New automation request:\nEmail: ${email}\nBusiness: ${businessName}\nInterested in: ${automationLine}`

  try {
    const webhookRes = await deps.fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!webhookRes.ok) {
      console.error(`marketplace-test-capture: webhook responded with status ${webhookRes.status}`)
      return jsonResponse({ error: GENERIC_ERROR }, 500)
    }
  } catch (err) {
    console.error('marketplace-test-capture: webhook call failed', err)
    return jsonResponse({ error: GENERIC_ERROR }, 500)
  }

  return jsonResponse({ ok: true }, 200)
}

if (import.meta.main) {
  Deno.serve((req) => handleMarketplaceCapture(req))
}
