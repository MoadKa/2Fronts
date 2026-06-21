// Verifies the X-Twilio-Signature header per Twilio's request validation spec:
// HMAC-SHA1 of (full request URL + sorted-by-key form param concatenation),
// base64-encoded, compared against the header. Same authentication pattern
// already used for Stripe's stripe.webhooks.constructEventAsync in this repo.
export async function verifyTwilioSignature(
  url: string,
  formParams: Record<string, string>,
  signatureHeader: string,
  authToken: string
): Promise<boolean> {
  const sortedKeys = Object.keys(formParams).sort()
  const data = url + sortedKeys.map((key) => `${key}${formParams[key]}`).join('')

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  const computed = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))

  return computed === signatureHeader
}
