export type TwilioFetcher = (url: string, init?: RequestInit) => Promise<Response>

interface TwilioConfig {
  fetcher: TwilioFetcher
  accountSid: string
  authToken: string
}

function defaultConfig(): TwilioConfig {
  return {
    fetcher: fetch,
    accountSid: Deno.env.get('TWILIO_ACCOUNT_SID')!,
    authToken: Deno.env.get('TWILIO_AUTH_TOKEN')!,
  }
}

function authHeader(accountSid: string, authToken: string): string {
  return `Basic ${btoa(`${accountSid}:${authToken}`)}`
}

// Dutch (+31) mobile numbers require no Regulatory Bundle -- self-serve
// for individuals, no business registration -- chosen specifically to avoid
// Germany's business-only number-assignment requirement (a BNetzA rule for
// the German country code, unrelated to whether a Gewerbe is needed to
// legally invoice customers, which this choice does not resolve either way).
// See akaou-main-design-20260620-132616.md Germany-Specific Dependencies.
export async function purchaseNumber(
  businessName: string,
  config: TwilioConfig = defaultConfig()
): Promise<{ phoneNumber: string; sid: string }> {
  const { fetcher, accountSid, authToken } = config
  const auth = authHeader(accountSid, authToken)

  const searchRes = await fetcher(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/AvailablePhoneNumbers/NL/Mobile.json`,
    { headers: { Authorization: auth } }
  )
  const searchData = (await searchRes.json()) as { available_phone_numbers?: { phone_number: string }[] }
  const candidate = searchData.available_phone_numbers?.[0]
  if (!candidate) {
    throw new Error('No available Dutch mobile numbers found')
  }

  const purchaseRes = await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      PhoneNumber: candidate.phone_number,
      FriendlyName: businessName,
    }),
  })
  const purchaseData = (await purchaseRes.json()) as { phone_number?: string; sid?: string; message?: string }
  if (!purchaseRes.ok) {
    throw new Error(purchaseData.message ?? 'Twilio number purchase failed')
  }

  return { phoneNumber: purchaseData.phone_number!, sid: purchaseData.sid! }
}
