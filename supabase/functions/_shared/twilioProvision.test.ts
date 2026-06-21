import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { purchaseNumber, type TwilioFetcher } from './twilioProvision.ts'

function fakeFetch(responses: { search?: unknown; purchase?: unknown; searchStatus?: number; purchaseStatus?: number }): TwilioFetcher {
  return (url: string) => {
    if (url.includes('AvailablePhoneNumbers')) {
      return Promise.resolve(
        new Response(JSON.stringify(responses.search ?? { available_phone_numbers: [] }), {
          status: responses.searchStatus ?? 200,
        })
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify(responses.purchase ?? {}), { status: responses.purchaseStatus ?? 201 })
    )
  }
}

// Dutch (+31) mobile numbers require no Regulatory Bundle (self-serve for
// individuals, no business registration) -- chosen over German numbers
// specifically to avoid that requirement during the pre-revenue validation
// phase. See akaou-main-design-20260620-132616.md Germany-Specific
// Dependencies for the full rationale.

Deno.test('searches Dutch mobile numbers, not German, and requires no bundle', async () => {
  let searchUrl = ''
  let purchaseBody = ''
  const fetcher: TwilioFetcher = (url, init) => {
    if (url.includes('AvailablePhoneNumbers')) {
      searchUrl = url
      return Promise.resolve(
        new Response(JSON.stringify({ available_phone_numbers: [{ phone_number: '+31612345678' }] }), { status: 200 })
      )
    }
    purchaseBody = init?.body?.toString() ?? ''
    return Promise.resolve(new Response(JSON.stringify({ phone_number: '+31612345678', sid: 'PN123' }), { status: 201 }))
  }

  const result = await purchaseNumber('Acme Plumbing', { fetcher, accountSid: 'AC1', authToken: 'secret' })

  assertEquals(result, { phoneNumber: '+31612345678', sid: 'PN123' })
  assertEquals(searchUrl.includes('/NL/Mobile.json'), true)
  assertEquals(searchUrl.includes('/DE/'), false)
  assertEquals(purchaseBody.includes('BundleSid'), false)
})

Deno.test('throws when no available Dutch mobile numbers are found', async () => {
  const fetcher = fakeFetch({ search: { available_phone_numbers: [] } })

  await assertRejects(
    () => purchaseNumber('Acme Plumbing', { fetcher, accountSid: 'AC1', authToken: 'secret' }),
    Error,
    'No available Dutch mobile numbers found'
  )
})

Deno.test('throws when the Twilio purchase request fails', async () => {
  const fetcher = fakeFetch({
    search: { available_phone_numbers: [{ phone_number: '+31612345678' }] },
    purchaseStatus: 400,
    purchase: { message: 'insufficient funds' },
  })

  await assertRejects(
    () => purchaseNumber('Acme Plumbing', { fetcher, accountSid: 'AC1', authToken: 'secret' }),
    Error,
    'insufficient funds'
  )
})
