// concierge-setup: link a freshly-created concierge to its provision (#24).
//
// After a coach buys the AI Booking Concierge and fills the setup form, the
// browser creates the concierges row directly (RLS lets an owner write their
// own). But the provision -> concierge link lives on automation_provisions.config,
// which customers cannot UPDATE (RLS: only admins / the service-role client).
// So this small function does that one server-side write, gated by JWT-owns-
// provision authz — exactly the posture of slack-configure's 'confirm' action.
//
// SECOND ACTION (20260809100000): the follow-up SENDER IDENTITY. When the coach
// fills the optional "who is sending these mails" panel and ticks the
// acknowledgement, the browser posts it here instead of writing it itself,
// because followup_sender_ack_at / _version are locked against client writes by
// prevent_concierge_activation_client_write. That lock is the point: an
// attestation the attesting party can write is not an attestation. Only this
// function, with the service role, stamps it — and only after re-checking the
// input server-side, since the browser's validation is a courtesy, not a gate.
//
// AND, HANGING OFF THAT SECOND ACTION: the reply-to VERIFICATION ROUND-TRIP.
// Saving an address is not proof the coach reads it, so this function also
// sends the mail that asks (best-effort, never failing the save) and clears
// followup_reply_to_verified_at whenever the address changes. The stamp itself
// is written by concierge-followup-verify-reply-to when the coach clicks. Until
// that click, decideSend() cancels every queued follow-up with
// `reply_to_unverified`, so this pair is what the whole send path waits on.
//
// All external effects are injected so the handler is unit-tested offline.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { sendEmail } from '../_shared/email.ts'
import {
  buildReplyToVerifyMail,
  buildReplyToVerifyUrl,
  normalizeReplyTo,
  replyToDigest,
} from '../_shared/replyToVerifyMail.ts'

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

export interface ConciergeSetupDeps {
  createAdminClient: () => SupabaseClient
  getUserId: (authHeader: string) => Promise<string | null>
  // Injectable mail transport for the reply-to verification mail, so tests stay
  // offline. Defaults to the shared Resend transport.
  sendMail?: typeof sendEmail
  // Injectable env reader, so the verification path's configuration branches are
  // testable without touching the process environment.
  env?: (key: string) => string | undefined
  // Fixed-window cap, same contract as concierge-chat's hitBucket: true = allowed.
  verifyMailCap?: (key: string, max: number, windowSecs: number) => Promise<boolean>
}

async function defaultGetUserId(authHeader: string): Promise<string | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon || !authHeader) return null
  const client = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const { data } = await client.auth.getUser()
  return data.user?.id ?? null
}

const defaultDeps: ConciergeSetupDeps = {
  createAdminClient,
  getUserId: defaultGetUserId,
}

// Resolve the provision's config + owning customer, enforcing the caller owns it.
// Mirrors slack-configure's loadOwnedProvision.
async function loadOwnedProvision(
  admin: SupabaseClient,
  provisionId: string,
  uid: string,
): Promise<{ config: Record<string, unknown>; paid: boolean } | { error: Response }> {
  const { data, error } = await admin
    .from('automation_provisions')
    .select('config, automation_requests(customer_id, status)')
    .eq('id', provisionId)
    .maybeSingle()
  if (error || !data) {
    return { error: new Response(JSON.stringify({ error: 'provision_not_found' }), { status: 404, headers: jsonHeaders }) }
  }
  const rel = (data as { automation_requests?: unknown }).automation_requests
  const reqRow = (Array.isArray(rel) ? rel[0] : rel) as { customer_id?: string; status?: string } | undefined
  const customerId = reqRow?.customer_id
  if (!customerId) {
    return { error: new Response(JSON.stringify({ error: 'provision_not_found' }), { status: 404, headers: jsonHeaders }) }
  }
  if (customerId !== uid) {
    return { error: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: jsonHeaders }) }
  }
  const config = ((data as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>
  // checkout.session.completed flips the request to 'paid' (including for a
  // trial, where the session still completes at 0 €). This is the purchase
  // signal that decides whether the concierge is allowed to go live.
  return { config, paid: reqRow?.status === 'paid' }
}

// Entitlement granted at setup, before Stripe has told us anything about periods.
//
// The renewal webhook cannot cover the first period: customer.subscription.updated
// fires when the subscription is created, which is BEFORE the coach has finished
// the wizard, so config.concierge_id does not exist yet and syncEntitlement has
// nothing to write to. Without a bootstrap here the concierge would sit dark
// until the first renewal, a month later. The next real subscription event
// overwrites this with Stripe's actual current_period_end.
const BOOTSTRAP_ENTITLEMENT_MS = 35 * 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Follow-up sender identity
// ---------------------------------------------------------------------------

// Which wording of the "you are the sender" acknowledgement was on screen. Same
// discipline as CONSENT_NOTICE_VERSION in _shared/consent.ts: change a character
// of the wizard's acknowledgement text and this becomes a NEW version, so an old
// row keeps proving what it was collected under. Never retro-fit.
export const FOLLOWUP_SENDER_ACK_VERSION = 'concierge-followup-sender-v1'

// Storage caps. The sender block is free text on purpose (address shapes differ
// per country and legal form), so it gets a length ceiling rather than a shape.
const SENDER_BLOCK_MAX = 500
const PRIVACY_URL_MAX = 500
const REPLY_TO_MAX = 320 // RFC 5321 maximum path length

export interface FollowupSenderInput {
  sender_block: string
  privacy_url: string
  reply_to: string
}

// Re-validate everything the browser claims. Returns null for anything that is
// not a complete, well-formed sender identity — including a missing tick.
//
// ALL FOUR OR NOTHING. A footer with a name but no address, or an address but no
// privacy link, is not a partially compliant mail; it is a non-compliant mail
// that looks finished. And without the tick we would be recording an
// acknowledgement nobody gave.
export function parseFollowupSender(raw: unknown): FollowupSenderInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const f = raw as Record<string, unknown>
  if (f.ack !== true) return null

  const block = typeof f.sender_block === 'string' ? f.sender_block.trim() : ''
  const privacy = typeof f.privacy_url === 'string' ? f.privacy_url.trim() : ''
  const replyTo = typeof f.reply_to === 'string' ? f.reply_to.trim() : ''

  if (!block || block.length > SENDER_BLOCK_MAX) return null
  if (!privacy || privacy.length > PRIVACY_URL_MAX) return null
  if (!replyTo || replyTo.length > REPLY_TO_MAX) return null

  // The privacy link is printed in a mail sent to a third party, so it has to be
  // a real absolute web URL. A relative path or a javascript: URL would ship a
  // broken (or hostile) link in the coach's name.
  let url: URL
  try {
    url = new URL(privacy)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  // Deliberately loose: one @, no whitespace, a dot in the domain. Anything
  // stricter starts rejecting valid addresses, and the real proof that this
  // mailbox exists and is the coach's is the verification round-trip that writes
  // followup_reply_to_verified_at — not a regex.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) return null

  return { sender_block: block, privacy_url: privacy, reply_to: replyTo }
}

// ---------------------------------------------------------------------------
// Reply-to verification (the round-trip that unblocks the send path)
// ---------------------------------------------------------------------------
//
// decideSend() cancels every queued follow-up while
// concierges.followup_reply_to_verified_at is null, and the ONLY writer of that
// column is concierge-followup-verify-reply-to, reached by clicking the link in
// the mail this section sends. So this is the step that turns the whole
// follow-up pipeline from "cancels 100% of what it claims" into something that
// can send.
//
// IT IS BEST-EFFORT AND NEVER FAILS THE SAVE. Same posture as
// concierge-chat's captureConsent: the coach's sender identity is already
// stored by the time we get here, and a Resend outage, a missing secret or a
// tripped cap must cost the verification MAIL, never the coach's data. The
// failure direction is safe by construction: no mail means no verification,
// which means the send path keeps refusing to send. It cannot fail open.

// The signing secret. Mirrors concierge-followup-verify-reply-to's own constant;
// duplicated rather than imported because an edge function importing another
// edge function's index.ts drags that whole module (and its admin client) into
// this one's bundle.
const REPLY_TO_SECRET_ENV = 'FOLLOWUP_REPLY_TO_SECRET'

// The pretty route. vercel.json rewrites it to the function; the function's own
// URL is the fallback so an unconfigured project still works. A verification
// link pointing at *.supabase.co reads as a phish to anyone who looks at it.
const VERIFY_PATH = '/absender-bestaetigen'

// Per-concierge daily ceiling on verification mails.
//
// The coach chooses followup_reply_to freely, so "save the panel again" is a
// button that sends a mail to any address they name, in 2Fronts' name. Five a
// day is far above a coach fixing a typo twice and far below anything useful as
// a mail cannon aimed at a third party.
const VERIFY_MAIL_DAILY_CAP = 5
const VERIFY_MAIL_WINDOW_SECS = 86_400

// Fixed-window counter, copied from concierge-chat's hitBucket. Fails CLOSED:
// this cap exists precisely because the mail can be aimed at an address the
// recipient never asked to hear from, so a database that will not answer must
// not become a free pass. A missing `.rpc` is a unit-test double, not a
// production condition, and always allows.
async function hitVerifyBucket(
  admin: SupabaseClient,
  key: string,
  max: number,
  windowSecs: number,
): Promise<boolean> {
  try {
    if (typeof (admin as { rpc?: unknown }).rpc !== 'function') return true
    const { data, error } = await admin.rpc('concierge_rate_limit_hit', {
      p_key: key,
      p_max: max,
      p_window_secs: windowSecs,
    })
    if (error) return false
    return data !== false
  } catch {
    return false
  }
}

interface VerifyMailCtx {
  admin: SupabaseClient
  conciergeId: string
  businessName: string
  language: string | null
  replyTo: string
  env: (key: string) => string | undefined
  sendMail: typeof sendEmail
  cap: (key: string, max: number, windowSecs: number) => Promise<boolean>
}

/**
 * Send the verification mail to the address the coach just saved.
 *
 * Returns whether a mail was accepted, for the response body only. Never
 * throws, never rejects: every branch either returns or logs and returns.
 */
async function sendReplyToVerification(ctx: VerifyMailCtx): Promise<boolean> {
  const secret = ctx.env(REPLY_TO_SECRET_ENV)
  const supabaseUrl = ctx.env('SUPABASE_URL')
  const apiKey = ctx.env('RESEND_API_KEY')
  const from = ctx.env('FOLLOWUP_FROM_DOMAIN')
  if (!secret || !supabaseUrl || !apiKey || !from) {
    // Loud: an unconfigured project stores the sender identity and can never
    // send a follow-up, and the visible symptom (every row cancelled with
    // reply_to_unverified) points at the wrong place.
    console.error('concierge-setup: reply-to verification mail is unconfigured; nothing sent')
    return false
  }

  if (!(await ctx.cap(`replyto-verify:${ctx.conciergeId}`, VERIFY_MAIL_DAILY_CAP, VERIFY_MAIL_WINDOW_SECS))) {
    console.error(`concierge-setup: reply-to verification cap reached for concierge ${ctx.conciergeId}`)
    return false
  }

  const publicBase = ctx.env('FOLLOWUP_PUBLIC_BASE_URL')
  const endpoint = publicBase
    ? `${publicBase.replace(/\/+$/, '')}${VERIFY_PATH}`
    : `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/concierge-followup-verify-reply-to`

  const verifyUrl = await buildReplyToVerifyUrl(endpoint, ctx.conciergeId, ctx.replyTo, secret)
  if (!verifyUrl) {
    console.error('concierge-setup: could not build a reply-to verification URL; nothing sent')
    return false
  }

  const mail = buildReplyToVerifyMail({
    concierge: { business_name: ctx.businessName, language: ctx.language },
    verifyUrl,
  })
  if (!mail) {
    console.error('concierge-setup: could not build the reply-to verification mail; nothing sent')
    return false
  }

  // Keyed on (concierge, address, hour). The digest makes a double-click on
  // "save" one mail rather than two; the hour bucket makes sure a coach whose
  // mail was lost can get another one by saving again, instead of being told
  // nothing for the 24 hours Resend deduplicates over.
  const digest = (await replyToDigest(ctx.replyTo, secret)) ?? ''
  const hour = new Date().toISOString().slice(0, 13)
  const result = await ctx.sendMail({
    apiKey,
    from,
    to: ctx.replyTo,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    idempotencyKey: `replyto:${ctx.conciergeId}:${digest.slice(0, 12)}:${hour}`,
  })
  if (!result.ok) {
    // No address and no raw provider body in the log: a Resend 4xx echoes the
    // recipient, and this log is not the place for it.
    console.error(`concierge-setup: reply-to verification mail rejected (status ${result.status ?? 'none'})`)
    return false
  }
  return true
}

export async function handleConciergeSetup(req: Request, deps: ConciergeSetupDeps = defaultDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: jsonHeaders })
  }

  let body: { provisionId?: unknown; conciergeId?: unknown; followupSender?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: jsonHeaders })
  }

  const provisionId = typeof body.provisionId === 'string' ? body.provisionId : ''
  const conciergeId = typeof body.conciergeId === 'string' ? body.conciergeId : ''
  if (!provisionId || !conciergeId) {
    return new Response(JSON.stringify({ error: 'provisionId and conciergeId are required' }), { status: 400, headers: jsonHeaders })
  }

  const uid = await deps.getUserId(req.headers.get('Authorization') ?? '')
  if (!uid) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  const admin = deps.createAdminClient()
  const loaded = await loadOwnedProvision(admin, provisionId, uid)
  if ('error' in loaded) return loaded.error

  // ---- Follow-up sender identity (optional, a SEPARATE call) --------------
  //
  // The wizard posts this from the "you're live" screen, after the link call
  // above already ran. It therefore must NOT redo the provision write: that
  // write sets status back to 'provisioning', and by now fulfillment may have
  // moved the provision on. So this branch returns early and touches exactly one
  // row: the coach's own concierge.
  if (body.followupSender !== undefined) {
    const sender = parseFollowupSender(body.followupSender)
    if (!sender) {
      return new Response(JSON.stringify({ error: 'followup_invalid' }), { status: 400, headers: jsonHeaders })
    }
    // Read the row BEFORE writing it, owner-scoped, for one question: is the
    // address the coach is saving the SAME one that is currently verified? The
    // answer decides both halves of the round-trip below, and it cannot be
    // recovered after the update, because the update is what overwrites it.
    const { data: before, error: beforeErr } = await admin
      .from('concierges')
      .select('id, business_name, language, followup_reply_to, followup_reply_to_verified_at')
      .eq('id', conciergeId)
      .eq('owner_id', uid)
      .maybeSingle()
    if (beforeErr) {
      return new Response(JSON.stringify({ error: 'persist_failed' }), { status: 500, headers: jsonHeaders })
    }
    if (!before) {
      return new Response(JSON.stringify({ error: 'concierge_not_found' }), { status: 404, headers: jsonHeaders })
    }
    const current = before as {
      business_name?: string | null
      language?: string | null
      followup_reply_to?: string | null
      followup_reply_to_verified_at?: string | null
    }

    // A VERIFICATION MUST NEVER SURVIVE THE ADDRESS IT VERIFIED.
    //
    // followup_reply_to is the coach's own data and stays client-writable (see
    // 20260809100000), so this branch is not the only way it changes; but it is
    // the way the wizard changes it, and leaving the stamp in place here would
    // mean a coach verifies a mailbox they control and then re-points Reply-To
    // at one they do not, inheriting our attestation that we checked. The
    // column comment says the stamp means "we proved the coach controls THIS
    // address". Keeping it across a change would make that sentence false.
    const alreadyVerified = !!current.followup_reply_to_verified_at &&
      normalizeReplyTo(current.followup_reply_to ?? '') === normalizeReplyTo(sender.reply_to)

    // owner_id is part of the filter, not merely the provision check: owning the
    // provision proves nothing about owning the concierge id in the body. Without
    // this, a caller with one paid provision could stamp an acknowledgement onto
    // someone else's setter.
    const { data: updated, error: senderErr } = await admin
      .from('concierges')
      .update({
        followup_sender_block: sender.sender_block,
        followup_privacy_url: sender.privacy_url,
        followup_reply_to: sender.reply_to,
        // Service-side, never from the browser: the two columns
        // 20260809100000's trigger refuses to a client.
        followup_sender_ack_at: new Date().toISOString(),
        followup_sender_ack_version: FOLLOWUP_SENDER_ACK_VERSION,
        // The coach asked for follow-up mail, so their switch goes on. It grants
        // nothing on its own — the send path still needs a confirmed visitor
        // consent and a verified reply-to. followup_reply_to_verified_at is
        // POINTEDLY not set here: a coach typing an address is not proof they
        // read it. That stamp belongs to the verification round-trip, and this
        // path only ever CLEARS it (see above), never sets it.
        ...(alreadyVerified ? {} : { followup_reply_to_verified_at: null }),
        followup_enabled: true,
      })
      .eq('id', conciergeId)
      .eq('owner_id', uid)
      .select('id')
    if (senderErr) {
      return new Response(JSON.stringify({ error: 'persist_failed' }), { status: 500, headers: jsonHeaders })
    }
    if (!updated || updated.length === 0) {
      return new Response(JSON.stringify({ error: 'concierge_not_found' }), { status: 404, headers: jsonHeaders })
    }

    // The round-trip. Best-effort, wrapped here rather than inside the helper so
    // that BOTH an { ok: false } result and a thrown transport failure end the
    // same way: the sender identity is saved, the coach gets their 200, and the
    // verification is simply absent (which the send path already reads as "do
    // not send"). An unwrapped rejection would answer 500 over a write that
    // succeeded, and the wizard would tell the coach their setup failed.
    let verificationMailSent = false
    if (!alreadyVerified) {
      try {
        verificationMailSent = await sendReplyToVerification({
          admin,
          conciergeId,
          businessName: current.business_name ?? '',
          language: current.language ?? null,
          replyTo: sender.reply_to,
          env: deps.env ?? ((k) => Deno.env.get(k) ?? undefined),
          sendMail: deps.sendMail ?? sendEmail,
          cap: deps.verifyMailCap ??
            ((key, max, windowSecs) => hitVerifyBucket(admin, key, max, windowSecs)),
        })
      } catch (e) {
        console.error('concierge-setup: reply-to verification mail threw', e)
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        followupSaved: true,
        ackVersion: FOLLOWUP_SENDER_ACK_VERSION,
        // What the wizard needs to say next: either "this address is already
        // confirmed" or "check that inbox". Never a claim that a mail went out
        // when it did not.
        replyToVerified: alreadyVerified,
        verificationMailSent,
      }),
      { status: 200, headers: jsonHeaders },
    )
  }

  // Merge the link into config without dropping any existing keys, and advance
  // the provision so fulfillment can proceed (the connector's provision is a
  // no-op success, so this is the meaningful "setup done" signal).
  const nextConfig = { ...loaded.config, concierge_id: conciergeId, conciergeLinkedAt: new Date().toISOString() }
  const { error: updErr } = await admin
    .from('automation_provisions')
    .update({ config: nextConfig, status: 'provisioning' })
    .eq('id', provisionId)
  if (updErr) {
    return new Response(JSON.stringify({ error: 'persist_failed' }), { status: 500, headers: jsonHeaders })
  }

  // Take the concierge live. Migration 20260729100000 makes every client-inserted
  // concierge start is_active = false with no entitlement, so THIS is the only
  // path by which a coach's setter begins serving — and it happens only against a
  // provision the caller owns AND that was actually paid for.
  //
  // An unpaid provision still gets linked (harmless, and it keeps a
  // mid-provisioning race from stranding the wizard) but stays dark. If payment
  // lands later the subscription webhook entitles it.
  if (loaded.paid) {
    const entitledUntil = new Date(Date.now() + BOOTSTRAP_ENTITLEMENT_MS).toISOString()
    const { data: activated, error: actErr } = await admin
      .from('concierges')
      .update({ is_active: true, entitled_until: entitledUntil })
      // owner_id belongs in the filter, not just the provision check. `admin` is
      // the SERVICE-ROLE client, so RLS is not consulted here at all and the only
      // ownership check is the one written on this line. Owning the provision
      // proves nothing about owning the conciergeId the caller put in the body:
      // without this, anyone holding one paid provision could pass a stranger's
      // concierge id and switch their setter live with a bootstrap entitlement.
      // The linking update at :210-211 already filters this way; this one did not.
      .eq('id', conciergeId)
      .eq('owner_id', uid)
      .select('id')
      .maybeSingle()
    if (actErr) {
      return new Response(JSON.stringify({ error: 'persist_failed' }), { status: 500, headers: jsonHeaders })
    }
    // Zero rows means the concierge is not the caller's. Answer the same 403 the
    // link step gives, rather than 200 { activated: true } over a row we never
    // touched — a lie the wizard would render as "you are live".
    if (!activated) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: jsonHeaders })
    }
  }
  return new Response(JSON.stringify({ ok: true, activated: loaded.paid }), { status: 200, headers: jsonHeaders })
}

if (import.meta.main) {
  Deno.serve((req) => handleConciergeSetup(req))
}
