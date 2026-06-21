import { assertEquals } from 'jsr:@std/assert@1'
import { handleSmsWebhook } from './index.ts'

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString()
}

function fakeAdminClient(opts: { provision: { id: string } | null; suppressInserts: unknown[] }) {
  return () => ({
    from(table: string) {
      if (table === 'automation_provisions') {
        return {
          select() {
            return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.provision, error: null }) }) }
          },
        }
      }
      if (table === 'automation_provision_opt_outs') {
        return {
          insert: (row: unknown) => {
            opts.suppressInserts.push(row)
            return Promise.resolve({ data: row, error: null })
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  })
}

Deno.test('returns 400 when the Twilio signature is invalid', async () => {
  const req = new Request('http://localhost/twilio-sms-webhook', {
    method: 'POST',
    body: formBody({ To: '+4915712345678', From: '+491701234567', Body: 'STOP' }),
  })

  const res = await handleSmsWebhook(req, {
    verifySignature: () => false,
    createAdminClient: fakeAdminClient({ provision: { id: 'prov-1' }, suppressInserts: [] }) as never,
  })

  assertEquals(res.status, 400)
})

Deno.test('suppresses the sender on a STOP reply (case and whitespace tolerant)', async () => {
  const opts = { provision: { id: 'prov-1' }, suppressInserts: [] as unknown[] }
  const req = new Request('http://localhost/twilio-sms-webhook', {
    method: 'POST',
    body: formBody({ To: '+4915712345678', From: '+491701234567', Body: '  stop  ' }),
  })

  const res = await handleSmsWebhook(req, {
    verifySignature: () => true,
    createAdminClient: fakeAdminClient(opts) as never,
  })

  assertEquals(res.status, 200)
  assertEquals(opts.suppressInserts.length, 1)
  assertEquals((opts.suppressInserts[0] as { phone: string }).phone, '+491701234567')
})

Deno.test('does not suppress on a non-STOP reply, just logs and returns empty TwiML', async () => {
  const opts = { provision: { id: 'prov-1' }, suppressInserts: [] as unknown[] }
  const req = new Request('http://localhost/twilio-sms-webhook', {
    method: 'POST',
    body: formBody({ To: '+4915712345678', From: '+491701234567', Body: 'What are your hours?' }),
  })

  const res = await handleSmsWebhook(req, {
    verifySignature: () => true,
    createAdminClient: fakeAdminClient(opts) as never,
  })

  assertEquals(res.status, 200)
  assertEquals(opts.suppressInserts.length, 0)
  const xml = await res.text()
  assertEquals(xml.includes('<Response'), true)
})

Deno.test('returns empty TwiML without crashing when no provision matches the number', async () => {
  const req = new Request('http://localhost/twilio-sms-webhook', {
    method: 'POST',
    body: formBody({ To: '+4915799999999', From: '+491701234567', Body: 'STOP' }),
  })

  const res = await handleSmsWebhook(req, {
    verifySignature: () => true,
    createAdminClient: fakeAdminClient({ provision: null, suppressInserts: [] }) as never,
  })

  assertEquals(res.status, 200)
})
