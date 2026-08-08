// Shared Resend transport.
//
// `notify-request` and `submit-wish` each carry their own inline copy of a
// fire-and-forget Resend call that answers a bare boolean. That is enough for a
// best-effort founder notification, but it is NOT enough for anything that
// retries: a boolean cannot tell a dispatcher whether the message was rejected
// (do not send again) or whether we simply never learned the outcome (safe to
// retry, but only with the SAME idempotency key). This module exists to make
// that distinction explicit and testable. See TODOS.md for the consolidation
// debt of the two older copies.
//
// The contract, in order of importance:
//
//   - sendEmail NEVER throws. Every failure path — a non-2xx, a network error,
//     an aborted request, an unreadable body — returns a SendEmailResult. A
//     dispatcher calling this from inside a queue loop must never have to guard
//     it with try/catch.
//
//   - `retryable` answers "is it worth trying again?": true for 429 (rate
//     limited), any status >= 500 (Resend-side failure), and any thrown fetch
//     error. A 4xx other than 429 is our own bad request — retrying it just
//     burns attempts on a payload that will be rejected identically.
//
//   - `indeterminate` answers the harder question: "could Resend have accepted
//     this message even though we are reporting a failure?" It is true ONLY
//     when the fetch threw or was aborted, because then the request may well
//     have reached Resend and we never saw the response. A definite non-2xx is
//     `indeterminate: false` — we hold Resend's own word that it was rejected.
//     This flag is what lets a caller decide between REUSING the idempotency
//     key (indeterminate: replay is deduplicated by Resend, so no double send)
//     and MINTING a new one (definite rejection: the old key is spent and a
//     retry under it could be silently swallowed). Getting it backwards either
//     double-sends to a customer or makes retries permanently invisible.
//
//   - The API key never reaches a log line or a returned string. We do not log
//     the request init, we do not log the outgoing headers, and every string we
//     surface from a response body or an error goes through `redact()` first,
//     because a provider error body is free to echo the credential it rejected.
//
// The fetch implementation is injected (default `globalThis.fetch`) exactly as
// the sibling modules do it, so the tests run fully offline.

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export interface SendEmailArgs {
  apiKey: string
  from: string
  // One address, or several — Resend accepts an array.
  to: string | string[]
  subject: string
  text?: string
  html?: string
  // Optional Reply-To. Sent as Resend's snake_case `reply_to` body field.
  replyTo?: string | string[]
  // Extra HTTP request headers, passed through to fetch unmodified. Applied
  // before the credential and the idempotency key so a caller can never clobber
  // either one by accident.
  headers?: Record<string, string>
  // Sent as the `Idempotency-Key` HTTP header. Omitted entirely when absent, so
  // a caller that does not opt in gets Resend's plain, non-deduplicated
  // behaviour rather than a stray empty header.
  idempotencyKey?: string
}

export interface SendEmailResult {
  ok: boolean
  // HTTP status, when we got one. Absent when the request never completed.
  status?: number
  // Resend's message id on success, when the response body carried one.
  id?: string
  // Redacted, length-bounded failure description. Never contains the API key.
  error?: string
  retryable: boolean
  indeterminate: boolean
}

export interface SendEmailDeps {
  fetcher?: Fetcher
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const REDACTED = '[redacted]'
// Bound what we hand back: provider bodies can be large, and this string ends
// up in logs and possibly a database column.
const MAX_ERROR_LEN = 1000

// Remove every literal occurrence of the credential from a string we are about
// to log or return. Deliberately unconditional for any non-empty key: over-
// redacting a short key is noise, under-redacting one is a credential leak.
function redact(text: string, apiKey: string): string {
  if (text === '') return ''
  const scrubbed = apiKey === '' ? text : text.split(apiKey).join(REDACTED)
  // Redact first, truncate second — the other order could leave a partial key.
  return scrubbed.length > MAX_ERROR_LEN ? `${scrubbed.slice(0, MAX_ERROR_LEN)}…` : scrubbed
}

// A failure we determined ourselves, without ever reaching the network: we know
// nothing was sent, so it is neither retryable nor indeterminate.
function localFailure(error: string): SendEmailResult {
  return { ok: false, error, retryable: false, indeterminate: false }
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException ? e.name === 'AbortError' : e instanceof Error && e.name === 'AbortError'
}

/**
 * Send one email through Resend.
 *
 * Never throws. See the module header for the exact `retryable` /
 * `indeterminate` semantics — they are the reason this module exists.
 */
export async function sendEmail(args: SendEmailArgs, deps: SendEmailDeps = {}): Promise<SendEmailResult> {
  const { apiKey, from, to, subject, text, html, replyTo, headers, idempotencyKey } = args

  // Guard locally rather than firing a request we know Resend will reject. Both
  // are definite: nothing was sent, and retrying an identical call cannot help.
  if (!apiKey) return localFailure('missing_api_key')
  if (text === undefined && html === undefined) return localFailure('missing_body')

  const fetcher: Fetcher = deps.fetcher ?? globalThis.fetch

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    // Caller-supplied headers land here: after the content type (which they may
    // legitimately override) but before the credential and the idempotency key.
    ...(headers ?? {}),
    Authorization: `Bearer ${apiKey}`,
  }
  if (idempotencyKey !== undefined && idempotencyKey !== '') {
    requestHeaders['Idempotency-Key'] = idempotencyKey
  }

  const payload: Record<string, unknown> = { from, to, subject }
  if (text !== undefined) payload.text = text
  if (html !== undefined) payload.html = html
  if (replyTo !== undefined) payload.reply_to = replyTo

  let res: Response
  try {
    res = await fetcher(RESEND_ENDPOINT, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(payload),
    })
  } catch (e) {
    // INDETERMINATE: the request may or may not have reached Resend. This is
    // the only shape of failure where a retry must reuse the idempotency key.
    const raw = e instanceof Error ? e.message : 'unknown'
    const error = isAbort(e) ? `aborted: ${redact(raw, apiKey)}` : redact(raw, apiKey)
    // Log the redacted reason only — never the init object, which holds the key.
    console.error('email: send failed (indeterminate)', error)
    return { ok: false, error, retryable: true, indeterminate: true }
  }

  // Reading the body is best-effort; a torn stream must not become a throw.
  let bodyText = ''
  try {
    bodyText = await res.text()
  } catch {
    bodyText = ''
  }

  if (!res.ok) {
    // DEFINITE rejection: Resend answered. Not indeterminate, whatever the code.
    const error = redact(bodyText.trim() === '' ? `HTTP ${res.status}` : bodyText.trim(), apiKey)
    const retryable = res.status === 429 || res.status >= 500
    // Status is safe to log; the body is redacted before it goes anywhere.
    console.error('email: resend responded', res.status, error)
    return { ok: false, status: res.status, error, retryable, indeterminate: false }
  }

  // 2xx: accepted. Pull the message id when the body has one, but a body we
  // cannot parse does not downgrade a success we were explicitly told about.
  let id: string | undefined
  try {
    const parsed = JSON.parse(bodyText) as { id?: unknown }
    if (typeof parsed?.id === 'string') id = parsed.id
  } catch {
    id = undefined
  }

  return { ok: true, status: res.status, id, retryable: false, indeterminate: false }
}
