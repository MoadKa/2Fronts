// Resolves and validates PUBLIC_APP_URL, the public origin Stripe redirects
// customers back to after checkout (create-checkout-session builds
// success_url/cancel_url from it). A wrong value here is not cosmetic: on
// 2026-06-21 the production secret still held a localhost dev URL, so every
// paid customer was redirected to http://localhost. This guard makes that
// failure loud and immediate instead of silently shipping a broken redirect.
//
// `allowInsecure` (wired to the ALLOW_INSECURE_APP_URL env var) is the explicit
// opt-in for local edge-function testing against http://localhost.
export function resolveAppBaseUrl(rawUrl: string | undefined, allowInsecure = false): string {
  if (!rawUrl || rawUrl.trim() === '') {
    throw new Error('PUBLIC_APP_URL is not configured')
  }

  const trimmed = rawUrl.trim().replace(/\/+$/, '')

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`PUBLIC_APP_URL is not a valid URL: ${trimmed}`)
  }

  if (allowInsecure) {
    return trimmed
  }

  const host = parsed.hostname
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local')
  if (isLocal) {
    throw new Error(
      `PUBLIC_APP_URL points to a local address (${host}); set it to the public site URL, ` +
        'or set ALLOW_INSECURE_APP_URL=true for local testing',
    )
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`PUBLIC_APP_URL must use https (got ${parsed.protocol})`)
  }

  return trimmed
}
