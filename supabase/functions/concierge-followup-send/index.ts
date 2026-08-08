// concierge-followup-send: drains the follow-up outbox.
//
// A scheduled GitHub Action POSTs this every 15 minutes (see
// .github/workflows/followup-tick.yml). It claims a batch of due rows, decides
// each one, and sends the ones that survive.
//
// THIS IS THE ONLY FUNCTION IN THE REPO THAT SENDS COMMERCIAL EMAIL. Everything
// else in the follow-up chain either collects a consent or proves one. So the
// posture here is different from its siblings: it is NOT in config.toml, which
// means it keeps `verify_jwt = true`, AND it additionally demands a shared
// secret. Two locks, because the failure mode is not a leaked read, it is mail
// going out in a named person's business name.
//
// FAIL LOUD, NOT QUIET. A missing RESEND_API_KEY or FOLLOWUP_FROM_DOMAIN answers
// 503, never 200. A 200 would make an unconfigured project — which is what this
// repo is today — look perfectly healthy while sending nothing forever, and the
// only symptom would be a queue nobody is watching.
//
// NO LLM ANYWHERE IN THIS PATH. The legal sender of these mails is the coach. An
// unreviewed model sentence in a named person's name, under §7 UWG scrutiny, is
// indefensible. Everything sent here is deterministic template plus values the
// coach typed themselves. `_shared/entitlement.ts` exists precisely so this file
// can apply the entitlement rules without importing concierge-chat, which pulls
// in the Gemini client at module scope.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import {
  type ConsentLocale,
  type ConsentState,
  effectiveConsentState,
  normalizeConsentEmail,
} from '../_shared/consent.ts'
import { buildFollowupMail, clampLanguage } from '../_shared/followupContent.ts'
import { buildListUnsubscribeHeaders, buildUnsubscribeUrl } from '../_shared/followupToken.ts'
import { type SendEmailResult, sendEmail } from '../_shared/email.ts'
import { type AlertEvent, alert } from '../_shared/alerting.ts'
import { decideSend, MAX_ATTEMPTS } from './decide.ts'
// The reserved all-zeros concierge id under which a hard bounce or a complaint
// is recorded once, for every sender at once. See resend-webhook's header.
import { GLOBAL_SUPPRESSION_CONCIERGE_ID } from '../resend-webhook/index.ts'

const jsonHeaders = { 'Content-Type': 'application/json' }

// How many rows one tick handles. Small on purpose: the tick runs every 15
// minutes, so a backlog drains over a few ticks rather than in one burst that
// looks like a blast to a spam filter.
const BATCH_LIMIT = 25

// Resend's default rate limit is 2 requests per second. A 25-row batch fired
// flat gets 429s, which this code would dutifully treat as retryable and then
// re-fire. Space them instead.
const SEND_SPACING_MS = 600

// A 429 or a 5xx is the provider having a moment, not this row being wrong, so
// it must not burn one of the three real attempts. Capped anyway, or a provider
// outage becomes an infinite loop.
const MAX_SOFT_RETRIES = 8

export interface FollowupSendDeps {
  createAdminClient: () => SupabaseClient
  env?: (key: string) => string | undefined
  sendMail?: typeof sendEmail
  alertFn?: (event: AlertEvent) => Promise<boolean>
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

const defaultDeps: FollowupSendDeps = { createAdminClient }

// The recipient's local hour. We do not store a timezone per visitor, so this
// assumes Europe/Berlin: the product is German, sold to German coaches, and
// their prospects are overwhelmingly in that zone. Stated here rather than
// buried, because it is an assumption and not a fact.
function berlinHour(now: Date): number {
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    hour12: false,
  }).format(now)
  const h = Number.parseInt(s, 10)
  return Number.isFinite(h) ? h : now.getUTCHours()
}

export async function handleFollowupSend(
  req: Request,
  deps: FollowupSendDeps = defaultDeps,
): Promise<Response> {
  const env = deps.env ?? ((k: string) => Deno.env.get(k) ?? undefined)
  const nowFn = deps.now ?? (() => new Date())
  const alertFn = deps.alertFn ?? ((e: AlertEvent) => alert(e))
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: jsonHeaders,
    })
  }

  // The shared secret. Fails CLOSED when unset, following intake's posture: a
  // gate in front of an RLS-bypassing client that skips itself when
  // unconfigured is not a gate.
  const expected = env('FOLLOWUP_SECRET')
  if (!expected) {
    console.error('followup-send: FOLLOWUP_SECRET is not configured; refusing to run')
    return new Response(JSON.stringify({ error: 'misconfigured' }), {
      status: 503,
      headers: jsonHeaders,
    })
  }
  if (req.headers.get('x-followup-secret') !== expected) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: jsonHeaders,
    })
  }

  // The global env switch, separate from the per-row ops row in the database.
  // Two switches because they answer different questions: this one is "is this
  // deployment allowed to send at all", the database one is "stop right now"
  // and needs no deploy.
  if ((env('FOLLOWUP_SENDING') ?? '').toLowerCase() !== 'on') {
    return new Response(JSON.stringify({ received: true, skipped: 'global_env_off' }), {
      status: 200,
      headers: jsonHeaders,
    })
  }

  const apiKey = env('RESEND_API_KEY')
  const from = env('FOLLOWUP_FROM_DOMAIN')
  if (!apiKey || !from) {
    console.error('followup-send: RESEND_API_KEY or FOLLOWUP_FROM_DOMAIN is not set')
    return new Response(JSON.stringify({ error: 'misconfigured' }), {
      status: 503,
      headers: jsonHeaders,
    })
  }

  const admin = deps.createAdminClient()
  const sendMail = deps.sendMail ?? sendEmail
  const now = nowFn()

  // Claim a batch. The RPC holds `for update skip locked` and retires rows that
  // have exhausted their attempts in the same statement, so a row whose isolate
  // died mid-send cannot sit in 'sending' forever, invisible to both predicates.
  const { data: claimed, error: claimError } = await admin.rpc('concierge_followup_claim', {
    p_limit: BATCH_LIMIT,
    p_now: now.toISOString(),
  })
  if (claimError) {
    console.error('followup-send: claim failed:', claimError.message ?? claimError)
    return new Response(JSON.stringify({ error: 'claim_failed' }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  const rows = (claimed ?? []) as Array<Record<string, unknown>>
  const counts = { claimed: rows.length, sent: 0, cancelled: 0, deferred: 0, failed: 0 }

  for (let i = 0; i < rows.length; i++) {
    if (i > 0) await sleep(SEND_SPACING_MS)
    try {
      const outcome = await processOne(admin, rows[i], {
        env,
        apiKey,
        from,
        sendMail,
        alertFn,
        now: nowFn(),
      })
      counts[outcome] += 1
    } catch (e) {
      // One bad row must never stop the batch: the rest of the queue is other
      // people's mail.
      counts.failed += 1
      console.error('followup-send: row threw:', e instanceof Error ? e.message : e)
    }
  }

  return new Response(JSON.stringify({ received: true, ...counts }), {
    status: 200,
    headers: jsonHeaders,
  })
}

interface RowCtx {
  env: (k: string) => string | undefined
  apiKey: string
  from: string
  sendMail: typeof sendEmail
  alertFn: (event: AlertEvent) => Promise<boolean>
  now: Date
}

type RowOutcome = 'sent' | 'cancelled' | 'deferred' | 'failed'

async function processOne(
  admin: SupabaseClient,
  raw: Record<string, unknown>,
  ctx: RowCtx,
): Promise<RowOutcome> {
  const row = raw as unknown as {
    id: string
    concierge_id: string
    conversation_id: string | null
    email_normalized: string
    consent_id: string | null
    scheduled_at: string
    expires_at: string
    attempts: number
    soft_retries: number
  }

  const { data: conciergeRow } = await admin
    .from('concierges')
    .select(
      'id, slug, business_name, language, is_active, is_demo, demo_expires_at, entitled_until, calendar_url, followup_enabled, followup_sender_ack_at, followup_sender_block, followup_privacy_url, followup_reply_to, followup_reply_to_verified_at, followup_note',
    )
    .eq('id', row.concierge_id)
    .maybeSingle()
  const concierge = (conciergeRow ?? null) as
    | (Record<string, unknown> & { business_name?: string })
    | null

  // Consent, read fresh. Not trusted from enqueue time: a withdrawal between
  // arming and sending is precisely the case this has to honour.
  const { data: ledger } = await admin
    .from('concierge_consents')
    .select('action, created_at, visitor_email_norm, notice_text, locale')
    .eq('concierge_id', row.concierge_id)
    .eq('visitor_email_norm', row.email_normalized)
    .order('created_at', { ascending: false })
    .limit(50)
  const consentRows = (ledger ?? []) as Array<{
    action: 'granted' | 'confirmed' | 'withdrawn'
    created_at: string
    visitor_email_norm: string
    notice_text: string
    locale: ConsentLocale
  }>
  const consentState: ConsentState = effectiveConsentState(consentRows)
  const confirmed = consentRows.find((r) => r.action === 'confirmed') ?? null

  // Re-read suppression immediately before deciding. A bounce webhook can land
  // between the claim and the send.
  // BOTH pairs. The sentinel is what makes a hard bounce or a complaint stop
  // EVERY sender, not just the one that happened to trigger it. A dead mailbox
  // is dead for everyone, and someone who clicked "spam" once is not asking to
  // hear from the next coach instead. Asking only for the real pair would leave
  // the global row recorded and toothless.
  const { data: suppressedPairs } = await admin.rpc('concierge_followup_suppressed', {
    p_pairs: [
      { concierge_id: row.concierge_id, email_normalized: row.email_normalized },
      { concierge_id: GLOBAL_SUPPRESSION_CONCIERGE_ID, email_normalized: row.email_normalized },
    ],
  })
  const suppressed = Array.isArray(suppressedPairs) && suppressedPairs.length > 0

  const { data: sentAlready } = await admin
    .from('concierge_followup_outbox')
    .select('id')
    .eq('concierge_id', row.concierge_id)
    .eq('email_normalized', row.email_normalized)
    .eq('status', 'sent')
    .limit(1)
  const alreadyMailed = Array.isArray(sentAlready) && sentAlready.length > 0

  const decision = decideSend({
    row,
    concierge: concierge as never,
    consentState,
    consentEmail: confirmed ? normalizeConsentEmail(confirmed.visitor_email_norm) : null,
    suppressed,
    alreadyMailed,
    now: ctx.now,
    localHour: berlinHour(ctx.now),
  })

  if (decision.action === 'cancel') {
    await admin
      .from('concierge_followup_outbox')
      .update({ status: 'cancelled', cancel_reason: decision.reason })
      .eq('id', row.id)
    return 'cancelled'
  }

  if (decision.action === 'defer') {
    await admin
      .from('concierge_followup_outbox')
      .update({ status: 'pending', scheduled_at: decision.until, claimed_at: null })
      .eq('id', row.id)
    return 'deferred'
  }

  // ---- Send ---------------------------------------------------------------

  const unsubscribeUrl = await buildUnsubscribeUrl(
    ctx.env('FOLLOWUP_PUBLIC_BASE_URL') ?? '',
    row.concierge_id,
    row.conversation_id ?? '',
    ctx.env('FOLLOWUP_UNSUB_SECRET') ?? '',
  )
  if (!unsubscribeUrl) {
    // A commercial mail with no working way out is the §7 Abs. 2 Nr. 4 failure
    // this entire chain exists to avoid. Refuse, loudly, and do not burn an
    // attempt on a configuration fault the row cannot fix by waiting.
    console.error('followup-send: cannot build an unsubscribe URL; not sending')
    await admin
      .from('concierge_followup_outbox')
      .update({ status: 'cancelled', cancel_reason: 'no_unsubscribe_url' })
      .eq('id', row.id)
    await ctx.alertFn({
      type: 'followup_misconfigured',
      message: 'Follow-up send blocked: no unsubscribe URL could be built',
      fields: { concierge_id: row.concierge_id },
    })
    return 'cancelled'
  }

  const mail = buildFollowupMail({
    concierge: concierge as never,
    unsubscribeUrl,
    locale: confirmed?.locale ?? clampLanguage(concierge?.language),
    coachNote: (concierge?.followup_note as string | null) ?? null,
  })
  if (!mail) {
    await admin
      .from('concierge_followup_outbox')
      .update({ status: 'cancelled', cancel_reason: 'unbuildable_mail' })
      .eq('id', row.id)
    return 'cancelled'
  }

  // Increment attempts BEFORE the send, and abandon this row for this tick if
  // that write fails. Otherwise a row whose counter never moves retries forever.
  const nextAttempt = (row.attempts ?? 0) + 1
  const { error: attemptError } = await admin
    .from('concierge_followup_outbox')
    .update({ attempts: nextAttempt })
    .eq('id', row.id)
  if (attemptError) {
    console.error('followup-send: could not record the attempt; skipping this row')
    return 'failed'
  }

  // IDEMPOTENCY KEY. Stable while the outcome is unknown, fresh after a definite
  // rejection. Resend replays a cached response for a key for 24 hours, so a
  // FIXED key would make the whole retry ladder decorative: every retry after a
  // 4xx would get the cached 4xx back rather than actually retrying.
  const key = `outbox:${row.id}:${nextAttempt}`

  const result: SendEmailResult = await ctx.sendMail({
    apiKey: ctx.apiKey,
    from: ctx.from,
    to: row.email_normalized,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    replyTo: (concierge?.followup_reply_to as string | undefined) ?? undefined,
    headers: buildListUnsubscribeHeaders(unsubscribeUrl),
    idempotencyKey: key,
  })

  if (result.ok) {
    await admin
      .from('concierge_followup_outbox')
      .update({
        status: 'sent',
        sent_at: ctx.now.toISOString(),
        provider_id: result.id ?? null,
        // The evidence snapshot: what we sent, and what the person had agreed
        // to when we sent it. Stored together because being challenged means
        // being asked both questions at once.
        sent_subject: mail.subject,
        sent_body: mail.text,
        sent_consent_text: confirmed ? (consentRows.find((r) => r.action === 'granted')?.notice_text ?? null) : null,
        sent_consent_confirmed_at: confirmed?.created_at ?? null,
      })
      .eq('id', row.id)
    return 'sent'
  }

  // A 429 or a 5xx is the provider, not the row. Do not spend a real attempt.
  if (result.retryable) {
    const softRetries = (row.soft_retries ?? 0) + 1
    const exhausted = softRetries > MAX_SOFT_RETRIES
    await admin
      .from('concierge_followup_outbox')
      .update({
        status: exhausted ? 'failed' : 'pending',
        soft_retries: softRetries,
        attempts: row.attempts ?? 0, // give the attempt back
        claimed_at: null,
        // No provider body and no address here: a Resend 4xx quotes the
        // recipient, and this column is read by a human debugging a queue.
        last_error: `provider ${result.status ?? 'error'}`,
      })
      .eq('id', row.id)
    return exhausted ? 'failed' : 'deferred'
  }

  const failed = nextAttempt >= MAX_ATTEMPTS
  await admin
    .from('concierge_followup_outbox')
    .update({
      status: failed ? 'failed' : 'pending',
      claimed_at: null,
      last_error: `rejected ${result.status ?? 'error'}`,
    })
    .eq('id', row.id)
  return failed ? 'failed' : 'deferred'
}

if (import.meta.main) {
  Deno.serve((req) => handleFollowupSend(req))
}

// Referenced so `createClient` stays imported for parity with the sibling
// functions' dependency shape; the admin client itself comes from _shared.
export type { SupabaseClient }
void createClient
