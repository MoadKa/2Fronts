import { assertEquals } from 'jsr:@std/assert@1'
import { handleVoiceWebhook, type SmsSender } from './index.ts'

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString()
}

function fakeAdminClient(provision: unknown, optedOut = false) {
  return () => ({
    from(table: string) {
      if (table === 'automation_provision_opt_outs') {
        return {
          select() {
            return {
              eq() {
                return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: optedOut ? { id: 'opt-1' } : null, error: null }) }) }
              },
            }
          },
        }
      }
      return {
        select() {
          return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: provision, error: null }) }) }
        },
      }
    },
  })
}

Deno.test('returns 400 when the Twilio signature is invalid', async () => {
  const req = new Request('http://localhost/twilio-voice-webhook', {
    method: 'POST',
    body: formBody({ To: '+4915712345678', From: '+491701234567' }),
  })

  const res = await handleVoiceWebhook(req, {
    verifySignature: () => false,
    createAdminClient: fakeAdminClient(null) as never,
    sendSms: (() => Promise.resolve()) as SmsSender,
  })

  assertEquals(res.status, 400)
})

Deno.test('sends the fixed-template SMS and returns TwiML when the number matches an active provision', async () => {
  const provision = {
    id: 'prov-1', business_name: 'Acme Plumbing',
    booking_link: 'https://cal.com/acme',
    business_hours: 'Mon-Fri 9-5',
    status: 'active',
  }
  let smsTo = ''
  let smsBody = ''

  const req = new Request('http://localhost/twilio-voice-webhook', {
    method: 'POST',
    body: formBody({ To: '+4915712345678', From: '+491701234567' }),
  })

  const res = await handleVoiceWebhook(req, {
    verifySignature: () => true,
    createAdminClient: fakeAdminClient(provision) as never,
    sendSms: ((to: string, body: string) => {
      smsTo = to
      smsBody = body
      return Promise.resolve()
    }) as SmsSender,
  })

  assertEquals(res.status, 200)
  assertEquals(smsTo, '+491701234567')
  assertEquals(smsBody.includes('Acme Plumbing'), true)
  assertEquals(smsBody.includes('https://cal.com/acme'), true)
  assertEquals(smsBody.includes('reply STOP'), true)
  const xml = await res.text()
  assertEquals(xml.includes('<Response'), true)
})

Deno.test('returns generic TwiML without sending SMS when no provision matches the number', async () => {
  let sendCalled = false
  const req = new Request('http://localhost/twilio-voice-webhook', {
    method: 'POST',
    body: formBody({ To: '+4915799999999', From: '+491701234567' }),
  })

  const res = await handleVoiceWebhook(req, {
    verifySignature: () => true,
    createAdminClient: fakeAdminClient(null) as never,
    sendSms: (() => {
      sendCalled = true
      return Promise.resolve()
    }) as SmsSender,
  })

  assertEquals(res.status, 200)
  assertEquals(sendCalled, false)
})

Deno.test('still returns 200 TwiML when the outbound SMS send fails', async () => {
  const provision = { id: 'prov-1', business_name: 'Acme Plumbing', booking_link: 'https://cal.com/acme', business_hours: null, status: 'active' }
  const req = new Request('http://localhost/twilio-voice-webhook', {
    method: 'POST',
    body: formBody({ To: '+4915712345678', From: '+491701234567' }),
  })

  const res = await handleVoiceWebhook(req, {
    verifySignature: () => true,
    createAdminClient: fakeAdminClient(provision) as never,
    sendSms: (() => Promise.reject(new Error('Twilio send failed'))) as SmsSender,
  })

  assertEquals(res.status, 200)
})

// Regression: the query selects `status` but never branched on it, so a
// cancelled/failed/non-active provision still got the missed-call SMS sent
// to its callers — a recycled or cancelled number's customers would receive
// a message from a business that no longer has this automation active.
// Found by /ship's coverage audit on 2026-06-21.
Deno.test('returns generic TwiML without sending SMS when the matched provision is not active (e.g. cancelled)', async () => {
  const provision = {
    id: 'prov-1', business_name: 'Acme Plumbing',
    booking_link: 'https://cal.com/acme',
    business_hours: null,
    status: 'cancelled',
  }
  let sendCalled = false
  const req = new Request('http://localhost/twilio-voice-webhook', {
    method: 'POST',
    body: formBody({ To: '+4915712345678', From: '+491701234567' }),
  })

  const res = await handleVoiceWebhook(req, {
    verifySignature: () => true,
    createAdminClient: fakeAdminClient(provision) as never,
    sendSms: (() => {
      sendCalled = true
      return Promise.resolve()
    }) as SmsSender,
  })

  assertEquals(res.status, 200)
  assertEquals(sendCalled, false)
})

// Regression: a lead who already replied STOP (recorded in
// automation_provision_opt_outs by twilio-sms-webhook) kept receiving the
// automated missed-call SMS on every subsequent call, because this handler
// never checked that table before sending — the opt-out mechanism existed
// but was never wired into the only place that actually sends the message.
// Found by /ship's adversarial review on 2026-06-21 (live anti-spam/consent
// compliance issue, not just a test gap).
Deno.test('does not send the SMS when the caller already opted out (STOP) for this provision', async () => {
  const provision = { id: 'prov-1', business_name: 'Acme Plumbing', booking_link: 'https://cal.com/acme', business_hours: null, status: 'active' }
  let sendCalled = false
  const req = new Request('http://localhost/twilio-voice-webhook', {
    method: 'POST',
    body: formBody({ To: '+4915712345678', From: '+491701234567' }),
  })

  const res = await handleVoiceWebhook(req, {
    verifySignature: () => true,
    createAdminClient: fakeAdminClient(provision, true) as never,
    sendSms: (() => {
      sendCalled = true
      return Promise.resolve()
    }) as SmsSender,
  })

  assertEquals(res.status, 200)
  assertEquals(sendCalled, false)
})

Deno.test('returns 400 when To or From is missing from the form payload', async () => {
  const req = new Request('http://localhost/twilio-voice-webhook', {
    method: 'POST',
    body: formBody({ To: '+4915712345678' }),
  })

  const res = await handleVoiceWebhook(req, {
    verifySignature: () => true,
    createAdminClient: fakeAdminClient(null) as never,
    sendSms: (() => Promise.resolve()) as SmsSender,
  })

  assertEquals(res.status, 400)
})
