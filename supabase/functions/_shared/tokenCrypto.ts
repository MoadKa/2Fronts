// Symmetric encryption for connector secrets (e.g. Google OAuth refresh tokens)
// at rest. Uses Web Crypto AES-GCM with a 256-bit key derived from a base64
// env secret (CONNECTOR_TOKEN_KEY). A fresh random 12-byte IV is generated per
// encryption and prepended to the ciphertext; the whole blob is base64-encoded
// for storage in a text column.
//
// SECURITY: the key value is only ever read from Deno.env — never logged,
// echoed, or written to disk. Callers must store the OUTPUT of encryptToken,
// never the plaintext token.

const KEY_ENV = 'CONNECTOR_TOKEN_KEY'
const IV_BYTES = 12 // AES-GCM standard nonce length

function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function getKey(): Promise<CryptoKey> {
  const rawKey = Deno.env.get(KEY_ENV)
  if (!rawKey || rawKey.trim() === '') {
    throw new Error(`${KEY_ENV} is not configured`)
  }

  const keyBytes = base64Decode(rawKey.trim())
  if (keyBytes.length !== 32) {
    throw new Error(`${KEY_ENV} must decode to 32 bytes (256-bit AES key)`)
  }

  return await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)))
  const encoded = new TextEncoder().encode(plaintext)

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded),
  )

  // Prepend IV so decryptToken can recover it; one base64 blob for storage.
  const combined = new Uint8Array(new ArrayBuffer(iv.length + ciphertext.length))
  combined.set(iv, 0)
  combined.set(ciphertext, iv.length)
  return base64Encode(combined)
}

export async function decryptToken(ciphertext: string): Promise<string> {
  const key = await getKey()
  const combined = base64Decode(ciphertext)
  if (combined.length <= IV_BYTES) {
    throw new Error('ciphertext is too short to contain an IV')
  }

  const iv = combined.slice(0, IV_BYTES)
  const data = combined.slice(IV_BYTES)

  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return new TextDecoder().decode(plaintext)
}
