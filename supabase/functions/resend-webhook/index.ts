// resend-webhook: the provider telling us a mailbox is dead, or that a person
// pressed "this is spam".
//
// POST /functions/v1/resend-webhook
//
// WHY THIS IS NOT A NICE-TO-HAVE. One sending domain carries everything this
// project mails: the follow-up pipeline, `notify-request` (the founder's own
// order notifications) and `submit-wish`. Repeatedly mailing an address that
// hard-bounces is the single fastest way to lose that domain, and losing it does
// not just stop the follow-ups — it stops the founder finding out that somebody
// bought something. Complaints are worse still: Resend's AUP allows suspension
// at a 0.08% complaint rate, and this pipeline sends on the order of 300 mails a
// month, so ONE annoyed recipient is already four times the ceiling. There is no
// volume here to absorb a mistake. The only defence is to stop instantly and
// permanently, which is what this endpoint does.
//
// IT RUNS UNAUTHENTICATED. A provider carries no Supabase JWT, so config.toml
// sets verify_jwt = false and the entire security model is the Svix signature.
// Same posture as concierge-consent-confirm, for the same reason: nothing
// touches the database until the request has proven it came from Resend. An
// unsigned or mis-signed POST costs exactly one HMAC and never constructs an
// admin client, so this endpoint cannot be used to write suppressions for
// somebody else's leads — which, without the signature, is what it would be: a
// free denial-of-lead API with no authentication at all.
//
// ---------------------------------------------------------------------------
// THE DESIGN DECISION: SUPPRESSION IS GLOBAL, VIA A RESERVED ALL-ZEROS UUID
// ---------------------------------------------------------------------------
//
// concierge_followup_suppressions is keyed (concierge_id, email_normalized), so
// the table can only say "this address told THIS sender to stop". That is the
// wrong shape for both events handled here:
//
//   * A hard bounce means the mailbox does not exist. It does not exist for
//     every coach on the platform, not only for the one who happened to mail it
//     first. Recording it per-sender means the second coach discovers the same
//     dead address the same way — with another bounce against our domain.
//   * A complaint is a person saying "stop". Honouring that for one sender while
//     a second keeps mailing them is precisely how you earn the next complaint,
//     and this time from somebody who has already shown they press the button.
//
// Three ways to express "global" against this schema were available:
//
//   (a) a reserved all-zeros concierge_id, (b) making the column nullable, or
//   (c) a second table keyed on the address alone.
//
// THIS FILE USES (a): the row (00000000-0000-0000-0000-000000000000, address)
// means "no sender may mail this address". It was chosen because it needs NO
// migration — (b) is impossible without altering a primary key that already
// carries data, and (c) needs a new table plus new grants plus a second lookup
// in the send path. A reserved uuid is a value, not a schema change, so it can
// land in the same deploy as this endpoint and cannot fail halfway.
//
// THE PRICE, STATED PLAINLY SO NOBODY IS SURPRISED BY IT: the sentinel row is
// invisible to concierge_followup_suppressed(), because that function joins the
// caller's (concierge_id, email) pairs against the table and a real concierge id
// never equals all zeros. A global suppression therefore only bites if THE SEND
// PATH ALSO ASKS FOR THE SENTINEL PAIR — i.e. sends
// {concierge_id: GLOBAL_SUPPRESSION_CONCIERGE_ID, email} alongside the real pair
// for every address it is about to mail. GLOBAL_SUPPRESSION_CONCIERGE_ID is
// exported from here for exactly that purpose. Until the sender does that, the
// sentinel row is a record and not yet a brake, and this file compensates for
// the gap in the second half of the write (see below).
//
// A further consequence: an all-zeros uuid is a legal uuid, so nothing in the
// database stops a real concierge row ever being created with it. gen_random_uuid()
// will not produce it in the lifetime of the universe, and no code path lets a
// coach choose their own id, so the collision is theoretical — but it is a
// convention held in application code, not a constraint, and that is the honest
// weakness of choice (a). If this ever needs hardening, (c) is the upgrade.
//
// SO EACH EVENT WRITES IN TWO PLACES:
//
//   1. The sentinel row — the durable, sender-independent fact.
//   2. One row per concierge that already has an outbox row for this address,
//      written through concierge_followup_unsubscribe(), which in the SAME
//      transaction cancels that sender's pending/sending rows. This is what
//      makes the suppression effective TODAY against the existing read path,
//      and it is also how requirement "cancel any queued outbox rows" is met:
//      the RPC does both halves or neither, which matters, because recording an
//      objection while leaving a queued mail in place would send the very mail
//      the bounce was telling us not to send.
//
// SOFT BOUNCES ARE NOT GLOBAL. Resend reports a bounce sub-type: `Permanent`
// (the mailbox does not exist), `Transient` (full, greylisted, temporarily
// unavailable) and `Undetermined`. Only the first proves the mailbox is dead.
// Blocking every coach on the platform from ever mailing somebody because their
// inbox was full on a Tuesday is over-suppression with no upside, so a Transient
// bounce writes only the per-sender rows and cancels the queued mail; it does
// NOT write the sentinel. Anything we cannot read as Transient — including a
// missing or malformed bounce object — is treated as permanent, because between
// "suppress an address that was fine" and "keep mailing an address that is
// dead", only the second one costs a sending domain.
//
// THE `source` COLUMN SAYS 'provider_bounce' FOR COMPLAINTS TOO. The column's
// check constraint (20260812100000, section 2) admits exactly three values:
// visitor_unsubscribe, provider_bounce, operator. 'provider_complaint' is not
// one of them, and passing it would raise inside the RPC — which would leave the
// address UNSUPPRESSED, the exact failure this endpoint exists to prevent. So a
// complaint is recorded as provider_bounce: both mean "the provider told us".
// The event type is logged, so the distinction is not lost, only not in that
// column. Widening the constraint is a migration for another day.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT LOGGED
// ---------------------------------------------------------------------------
//
// Not the recipient address, and not the raw provider body — which quotes the
// address, the subject line and, for a bounce, the remote server's own message
// about it. Function logs are readable by anybody with dashboard access and are
// shipped off-platform by the log drain; they are not the place for the mailbox
// of a person who just told us to leave them alone. Counts and event types only.
// The same rule applies to every response body: nothing this endpoint returns
// echoes anything from the payload, so a misconfigured webhook URL pointed at an
// attacker cannot be used to read addresses back out of us.
//
// IDEMPOTENT BY CONSTRUCTION. Svix retries any non-2xx for about two days, so a
// redelivered event is ordinary. The suppression insert is ON CONFLICT DO
// NOTHING and the cancel is an UPDATE to a fixed status, so replaying an event
// changes nothing. That is why there is no svix-id dedupe table: it would be a
// second thing to keep correct in exchange for nothing.
//
// UNHANDLED EVENT TYPES GET A 200. email.sent, email.delivered, email.opened and
// whatever Resend adds next are answered `{"received":true}` without touching
// the database. A 4xx would make the provider retry them forever and eventually
// disable the endpoint — taking the bounce events, the ones that actually
// matter, down with it.
//
// A FAILED WRITE GETS A 500, ON PURPOSE. If the database refuses, we want the
// retry: a dropped bounce is a mailbox we go on mailing. Never a 200 for work we
// did not do.
//
// NEVER THROWS. Every path returns a Response. All external effects are
// injected, so the tests run offline against a hand-rolled fake client, exactly
// like concierge-consent-confirm.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { CONSENT_EMAIL_MAX, normalizeConsentEmail } from '../_shared/consent.ts'

// The reserved sender id meaning "every sender". See the header. Exported so the
// send path can include it in its concierge_followup_suppressed() pairs — a
// global suppression is only a brake once it does.
export const GLOBAL_SUPPRESSION_CONCIERGE_ID = '00000000-0000-0000-0000-000000000000'

const OUTBOX_TABLE = 'concierge_followup_outbox'
const UNSUBSCRIBE_RPC = 'concierge_followup_unsubscribe'

// The only value the suppressions check constraint has for "the provider told
// us". See the header for why a complaint lands here too.
const SUPPRESSION_SOURCE = 'provider_bounce'

const SECRET_ENV = 'RESEND_WEBHOOK_SECRET'

// Svix's own tolerance. A captured payload replayed a day later fails on this
// even though its signature is still arithmetically valid, which is the whole
// point: without it, one leaked request body is a permanent write primitive.
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60

// Bound the work an unauthenticated caller can make us do before the signature
// is checked. A bounce payload is a couple of kilobytes; 64 KiB is generous.
const MAX_BODY_BYTES = 64 * 1024

// Svix sends one signature per active signing key, space separated. More than a
// handful means somebody is trying to make us hash all afternoon.
const MAX_SIGNATURES = 10

// A follow-up is always single-recipient, and so is every transactional mail
// this project sends. A payload listing more addresses than this is not ours.
const MAX_RECIPIENTS = 10

// How many outbox rows we look at to discover which senders have mailed, or are
// about to mail, this address. Far above anything real: the partial unique index
// allows one *sent* row per (sender, address), so this is bounded by the number
// of coaches plus their queued retries.
const OUTBOX_SCAN_LIMIT = 200

export interface ResendWebhookDeps {
  createAdminClient: () => SupabaseClient
  env: (key: string) => string | undefined
  now: () => Date
}

const defaultDeps: ResendWebhookDeps = {
  createAdminClient,
  env: (key) => Deno.env.get(key),
  now: () => new Date(),
}

// --- Signature -------------------------------------------------------------

// Constant-time-ish compare, same shape as oauthState.ts's. Duplicated rather
// than exported from there because that module's crypto is base64url over a
// string secret and this one is standard base64 over raw key bytes; sharing one
// helper would mean sharing neither.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function base64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

// Svix signing keys are `whsec_` + standard base64 of the raw key bytes. Some
// dashboards hand out the value without the prefix, and an operator can paste a
// plain string into the secret store by mistake — so we fall back to the UTF-8
// bytes rather than failing closed on a decode error. The fallback is not a
// security relaxation: a wrong derivation simply produces a signature that
// matches nothing. It only decides WHICH wrong answer a misconfiguration gives.
function signingKeyBytes(secret: string): Uint8Array {
  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  try {
    const bin = atob(raw)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return new TextEncoder().encode(raw)
  }
}

async function hmacBase64(message: string, keyBytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
  return base64(sig)
}

/**
 * Verify a Svix-style webhook signature. Returns true only when the headers are
 * present, the timestamp is inside the tolerance window, and at least one
 * offered `v1,` signature matches an HMAC of `<id>.<timestamp>.<body>` under the
 * signing key. Fails closed on anything else, including a thrown crypto call.
 *
 * Exported for the send path's future use and for direct testing; the handler
 * below is the only caller today.
 */
export async function verifyResendSignature(
  req: Request,
  body: string,
  secret: string,
  nowMs: number,
): Promise<boolean> {
  try {
    if (!secret) return false

    // Svix's own header names, plus the vendor-neutral `webhook-*` spellings the
    // same library emits when configured for the Standard Webhooks draft.
    const id = req.headers.get('svix-id') ?? req.headers.get('webhook-id')
    const timestamp = req.headers.get('svix-timestamp') ?? req.headers.get('webhook-timestamp')
    const offered = req.headers.get('svix-signature') ?? req.headers.get('webhook-signature')
    if (!id || !timestamp || !offered) return false

    // The timestamp is part of the signed content, so it cannot be edited by
    // whoever replays the body — but it CAN be replayed unchanged, and without
    // this window it would stay valid forever.
    const seconds = Number(timestamp)
    if (!Number.isFinite(seconds)) return false
    if (Math.abs(Math.floor(nowMs / 1000) - seconds) > TIMESTAMP_TOLERANCE_SECONDS) return false

    const expected = await hmacBase64(`${id}.${timestamp}.${body}`, signingKeyBytes(secret))

    // Compare against every offered v1 signature, and do NOT return early on the
    // first match: the loop is bounded and constant in the number of candidates,
    // so a caller cannot learn which of several keys matched from the timing.
    let matched = false
    const parts = offered.split(' ').slice(0, MAX_SIGNATURES)
    for (const part of parts) {
      const comma = part.indexOf(',')
      if (comma < 0) continue
      if (part.slice(0, comma) !== 'v1') continue
      if (safeEqual(part.slice(comma + 1), expected)) matched = true
    }
    return matched
  } catch {
    // A malformed header that makes the crypto throw is a rejected request, not
    // a 500.
    return false
  }
}

// --- Payload ---------------------------------------------------------------

interface ResendBounce {
  type?: unknown
  subType?: unknown
}

interface ResendEventData {
  to?: unknown
  bounce?: unknown
}

interface ResendEvent {
  type?: unknown
  data?: unknown
}

const ANGLE_ADDRESS = /<([^<>]+)>/

// Pull normalised recipients out of `data.to`, which is an array of either bare
// addresses or `Display Name <addr@example.test>` forms.
//
// Every address in the list is acted on. For this project that is exact: both
// the follow-up sender and the transactional mailers send to a single recipient,
// so a multi-address payload is not a mail we produced. Should that ever change,
// note that Resend's bounce event describes the MESSAGE and not which of several
// recipients failed — so a multi-recipient send would need the provider's
// per-recipient detail before this could stay honest.
function recipientsFrom(data: unknown): string[] {
  const to = (data as ResendEventData | null | undefined)?.to
  const list = typeof to === 'string' ? [to] : Array.isArray(to) ? to : []
  const out: string[] = []
  for (const entry of list.slice(0, MAX_RECIPIENTS)) {
    if (typeof entry !== 'string') continue
    const match = entry.match(ANGLE_ADDRESS)
    // normalizeConsentEmail, not a local lower/trim: the suppression rows written
    // here have to collide with the outbox rows written by the sender, and those
    // are normalised by that function. If the two ever drift, a bounce stops
    // matching the very mail that caused it.
    const address = normalizeConsentEmail(match ? match[1] : entry)
    if (!address || address.length > CONSENT_EMAIL_MAX) continue
    // Not a validator — just enough to refuse a display name that reached here
    // without an address in it.
    if (!address.includes('@') || /\s/.test(address)) continue
    if (!out.includes(address)) out.push(address)
  }
  return out
}

// True when the provider explicitly told us the failure was temporary. Anything
// else — permanent, undetermined, absent, misspelt — is treated as permanent.
// See the header: the asymmetry is deliberate.
function isTransientBounce(data: unknown): boolean {
  const bounce = (data as ResendEventData | null | undefined)?.bounce as ResendBounce | null | undefined
  if (!bounce || typeof bounce !== 'object') return false
  const type = bounce.type
  return typeof type === 'string' && type.toLowerCase() === 'transient'
}

// --- Handler ---------------------------------------------------------------

const RECEIVED = JSON.stringify({ received: true })

function json(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export async function handleResendWebhook(
  req: Request,
  deps: ResendWebhookDeps = defaultDeps,
): Promise<Response> {
  try {
    // A webhook is a POST. Nothing else gets as far as reading a body.
    if (req.method !== 'POST') return json(JSON.stringify({ error: 'method_not_allowed' }), 405)

    const secret = deps.env(SECRET_ENV) ?? ''
    if (!secret) {
      // Fail closed and say so. Without the secret nothing can be verified, and
      // acting on an unverified bounce is worse than missing one. A 500 keeps
      // the provider retrying, so the events survive the deploy that fixes it.
      console.error(`resend-webhook: ${SECRET_ENV} is not set`)
      return json(JSON.stringify({ error: 'not_configured' }), 500)
    }

    let body: string
    try {
      body = await req.text()
    } catch {
      return json(JSON.stringify({ error: 'unreadable_body' }), 400)
    }
    // Checked before the HMAC so an unauthenticated caller cannot make us hash
    // an arbitrary amount of data.
    if (body.length > MAX_BODY_BYTES) {
      console.warn('resend-webhook: rejected oversized body', body.length)
      return json(JSON.stringify({ error: 'invalid_signature' }), 400)
    }

    // EVERYTHING ABOVE HAS TOUCHED NO DATABASE, AND SO DOES EVERYTHING UNTIL THE
    // createAdminClient() CALL FAR BELOW. A forged POST stops on the next line
    // having cost one HMAC.
    const verified = await verifyResendSignature(req, body, secret, deps.now().getTime())
    if (!verified) {
      // No detail, no echo of the body: a rejected caller learns only that it
      // was rejected.
      console.warn('resend-webhook: rejected an unsigned or mis-signed request')
      return json(JSON.stringify({ error: 'invalid_signature' }), 400)
    }

    let event: ResendEvent
    try {
      event = JSON.parse(body) as ResendEvent
    } catch {
      // Signed but unparseable. That is our provider sending nonsense, so it is
      // worth a log — but the body is never in it.
      console.error('resend-webhook: signed payload was not valid JSON')
      return json(JSON.stringify({ error: 'invalid_payload' }), 400)
    }

    const type = typeof event?.type === 'string' ? event.type : ''
    if (type !== 'email.bounced' && type !== 'email.complained') {
      // email.sent, email.delivered, email.opened, and whatever comes next.
      // 200, no client, no write. See the header for why this must not be a 4xx.
      return json(RECEIVED, 200)
    }

    const recipients = recipientsFrom(event?.data)
    if (recipients.length === 0) {
      // A bounce we cannot attribute to an address. Nothing to suppress, and
      // retrying would not produce one, so this is a 200 with a log — the count
      // is the signal that the payload shape has moved.
      console.warn('resend-webhook: no usable recipient on', type)
      return json(RECEIVED, 200)
    }

    // Transient applies only to bounces; a complaint is always the person.
    const global = type === 'email.complained' || !isTransientBounce(event?.data)

    let admin: SupabaseClient
    try {
      admin = deps.createAdminClient()
    } catch (e) {
      console.error('resend-webhook: admin client unavailable', e)
      return json(JSON.stringify({ error: 'unavailable' }), 500)
    }

    let suppressed = 0
    let cancelled = 0
    let failures = 0

    for (const address of recipients) {
      // Which senders know this address? Every one of them gets a per-sender
      // suppression and has its queued rows cancelled, in the RPC's single
      // transaction. This is the half that bites today; the sentinel below is
      // the half that outlives this address's history.
      const { data: rows, error: scanError } = await admin
        .from(OUTBOX_TABLE)
        .select('concierge_id')
        .eq('email_normalized', address)
        .limit(OUTBOX_SCAN_LIMIT)

      if (scanError) {
        // Do NOT read a failed scan as "no senders". Losing the per-sender half
        // would leave queued mail in place for an address that just bounced.
        console.error('resend-webhook: outbox scan failed', scanError)
        failures++
        continue
      }

      const targets = new Set<string>()
      if (global) targets.add(GLOBAL_SUPPRESSION_CONCIERGE_ID)
      for (const row of (rows ?? []) as Array<{ concierge_id?: unknown }>) {
        if (typeof row?.concierge_id === 'string' && row.concierge_id) targets.add(row.concierge_id)
      }

      for (const conciergeId of targets) {
        const { data: cancelledRows, error: rpcError } = await admin.rpc(UNSUBSCRIBE_RPC, {
          p_concierge_id: conciergeId,
          p_email: address,
          p_source: SUPPRESSION_SOURCE,
        })
        if (rpcError) {
          // The sender id is safe to log; the address is not.
          console.error('resend-webhook: suppression failed for sender', conciergeId, rpcError)
          failures++
          continue
        }
        suppressed++
        cancelled += typeof cancelledRows === 'number' ? cancelledRows : 0
      }
    }

    // Counts and the event type. Never an address.
    console.log('resend-webhook:', type, {
      recipients: recipients.length,
      global,
      suppressed,
      cancelled,
      failures,
    })

    if (failures > 0) {
      // Partial work is still work — what was written stays written, and the
      // retry re-applies it harmlessly. The 500 is for the part that did not.
      return json(JSON.stringify({ error: 'partial_failure' }), 500)
    }

    return json(RECEIVED, 200)
  } catch (e) {
    // Nothing above is allowed to reach here, which is exactly why it exists. A
    // 500 asks the provider to send it again, which is what we want for an event
    // we demonstrably failed to process.
    console.error('resend-webhook: unhandled', e)
    return json(JSON.stringify({ error: 'unhandled' }), 500)
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleResendWebhook(req))
}
