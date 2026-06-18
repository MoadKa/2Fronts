import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@16'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature') ?? ''
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret)
  } catch {
    return new Response('Invalid signature', { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const requestId = session.metadata?.request_id
    if (requestId) {
      const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      await adminClient
        .from('automation_requests')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('stripe_checkout_session_id', session.id)
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
})
