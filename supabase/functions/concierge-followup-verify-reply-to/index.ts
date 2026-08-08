// concierge-followup-verify-reply-to: the click that unblocks the send path.
//
// GET /functions/v1/concierge-followup-verify-reply-to?t=v1.<concierge>.<addrDigest>.<sig>
//
// COACH-FACING TWIN OF concierge-consent-confirm. That endpoint is where a
// VISITOR proves they own the mailbox a consent was given for; this one is
// where a COACH proves they own the mailbox they set as Reply-To. It is the
// only writer of concierges.followup_reply_to_verified_at, and decideSend()
// cancels every queued row while that column is null, so without this endpoint
// the whole follow-up machine is a complete, tested pipeline that sends
// nothing.
//
// IT RUNS UNAUTHENTICATED. A coach following a link out of their mail client
// carries no JWT (they may not even be signed in, or may be on their phone), so
// config.toml sets verify_jwt = false and the whole security model is the token
// (_shared/replyToVerifyMail.ts). What that means, and what it does NOT mean:
//
//   1. THE SIGNATURE IS A DOORMAN FOR THE DATABASE. Anything that fails the
//      HMAC is refused before an admin client is even constructed, so an
//      attacker enumerating concierge ids cannot make us run one query, cannot
//      raise our database load, and cannot use response timing to learn which
//      guesses name a real setter.
//
//   2. THE TOKEN BINDS THE ADDRESS AS WELL AS THE SETTER. The endpoint
//      recomputes the keyed digest from the address the row holds RIGHT NOW and
//      refuses anything that does not match. A coach who verifies address A and
//      then edits their reply-to to address B does not inherit the
//      verification: the old link stops working the moment the address changes,
//      and concierge-setup additionally clears the column on that change. Both
//      halves are needed. The clear stops a STORED verification from surviving
//      its address; the digest stops an IN-FLIGHT link from landing on one it
//      never tested.
//
//   3. THE NEUTRAL PAGE NEVER SAYS WHICH FAILURE HAPPENED. Unknown, stale,
//      truncated, database down: one page, one status, one set of headers.
//
//   4. THE WORST AN ATTACKER WITH A STOLEN TOKEN CAN DO IS CONFIRM AN ADDRESS
//      THE COACH ALREADY CHOSE. There is nothing else behind this endpoint: it
//      reads no offer, returns no row, exposes no address (the token carries a
//      keyed digest, never the address itself), and the only write it performs
//      is one timestamp on one column. It cannot point Reply-To anywhere: only
//      the coach, signed in and owner-scoped, writes followup_reply_to. The
//      token reaches only the mailbox being verified, so "the attacker" here is
//      someone who already reads the coach's mail.
//
//   5. A LINK SCANNER'S GET IS INDISTINGUISHABLE FROM A HUMAN'S. Corporate mail
//      security prefetches links, so this endpoint MUST be idempotent, and it
//      is. It also means the verification can be recorded by a scanner rather
//      than by the coach. That is inherent to link-based verification, and it
//      is a far smaller problem here than on the consent side: a scanner inside
//      the coach's own mail infrastructure fetching the link still proves that
//      the mail reached that infrastructure, which is the thing being tested.
//
// HEAD NEVER VERIFIES. Outlook Safe Links, Proofpoint and Mimecast issue HEAD
// against every URL in an inbound mail as a matter of course. GET carries the
// same prefetch risk and is accepted anyway, because a human clicking really
// does produce a GET and refusing it would strand the coach; there is no such
// argument for HEAD, which no browser navigation emits. It answers the neutral
// page and touches nothing, exactly as concierge-consent-confirm does.
//
// IDEMPOTENCY. The row is read before it is written. Already stamped means the
// second click renders exactly the same page and writes nothing.
//
// NEVER THROWS. Every path, including a database that refuses to answer,
// returns a Response. The coach is holding a mail client, not a console.
//
// All external effects are injected, so the tests run offline against a
// hand-rolled fake client, exactly like concierge-consent-confirm.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { clampLocale, consentPageResponse, localeFromAcceptLanguage } from '../_shared/consentPage.ts'
import {
  renderReplyToVerifiedPage,
  renderReplyToVerifyNeutralPage,
} from '../_shared/replyToVerifyPage.ts'
import {
  REPLY_TO_VERIFY_TOKEN_PARAM,
  replyToDigest,
  verifyReplyToVerifyToken,
} from '../_shared/replyToVerifyMail.ts'

const TABLE = 'concierges'

// The signing secret for the verification link. Its own secret rather than a
// reuse of CONSENT_CONFIRM_SECRET: these tokens address different people, are
// minted by different code paths and have different blast radii, and a shared
// secret would mean rotating one flow silently rotates the other.
export const REPLY_TO_SECRET_ENV = 'FOLLOWUP_REPLY_TO_SECRET'

interface ConciergeRow {
  id: string
  business_name: string | null
  language: string | null
  followup_reply_to: string | null
  followup_reply_to_verified_at: string | null
}

export interface VerifyReplyToDeps {
  createAdminClient: () => SupabaseClient
  env: (key: string) => string | undefined
  now: () => Date
}

const defaultDeps: VerifyReplyToDeps = {
  createAdminClient,
  env: (key) => Deno.env.get(key),
  now: () => new Date(),
}

export async function handleVerifyReplyTo(
  req: Request,
  deps: VerifyReplyToDeps = defaultDeps,
): Promise<Response> {
  // The neutral page is built from the browser's own Accept-Language, never
  // from anything we would have to look up. It is the answer to every failure,
  // so it must be reachable without knowing anything at all.
  const neutralLocale = localeFromAcceptLanguage(req.headers.get('accept-language'))
  const neutral = (status = 200) =>
    consentPageResponse(renderReplyToVerifyNeutralPage(neutralLocale), status)

  try {
    // A browser follows a link with GET; HEAD is what some scanners send. No
    // CORS: this URL is navigated to, never fetched cross-origin, so it needs
    // no Access-Control headers and grants none.
    if (req.method !== 'GET' && req.method !== 'HEAD') return neutral(405)

    // HEAD NEVER VERIFIES, and never even looks the token up. See the header.
    if (req.method === 'HEAD') return neutral()

    const secret = deps.env(REPLY_TO_SECRET_ENV) ?? ''
    if (!secret) {
      // Fail closed and say so in the logs. Without the secret no link we ever
      // sent can be verified, which is a deployment fault, not a coach's.
      console.error(`concierge-followup-verify-reply-to: ${REPLY_TO_SECRET_ENV} is not set`)
      return neutral()
    }

    let raw: string | null
    try {
      raw = new URL(req.url).searchParams.get(REPLY_TO_VERIFY_TOKEN_PARAM)
    } catch {
      return neutral()
    }

    // Everything up to here has touched no database. A forged or truncated `t`
    // stops at this line, having cost one HMAC.
    const claim = await verifyReplyToVerifyToken(raw, secret)
    if (!claim) return neutral()

    let admin: SupabaseClient
    try {
      admin = deps.createAdminClient()
    } catch (e) {
      console.error('concierge-followup-verify-reply-to: admin client unavailable', e)
      return neutral()
    }

    // The one read. `claim.conciergeId` was matched against a UUID regex by the
    // token module before it got here, so nothing shaped like a filter can
    // reach this call.
    const { data, error } = await admin
      .from(TABLE)
      .select('id, business_name, language, followup_reply_to, followup_reply_to_verified_at')
      .eq('id', claim.conciergeId)
      .maybeSingle()

    if (error) {
      console.error('concierge-followup-verify-reply-to: lookup failed', error)
      return neutral()
    }
    if (!data) return neutral()

    const row = data as unknown as ConciergeRow
    const current = (row.followup_reply_to ?? '').trim()
    if (!current) return neutral()

    // THE ADDRESS BINDING. The token carries a keyed digest of the address the
    // mail went to; this recomputes it from the address the row holds now. A
    // coach who changed their reply-to since the mail was sent lands on the
    // neutral page, because a link that reached the OLD mailbox proves nothing
    // about the new one.
    const currentDigest = await replyToDigest(current, secret)
    if (!currentDigest || currentDigest !== claim.addressDigest) return neutral()

    const locale = clampLocale(row.language)
    const businessName = row.business_name ?? ''

    // Second click, prefetch, or a replay. Same page, no write.
    if (row.followup_reply_to_verified_at) {
      return consentPageResponse(renderReplyToVerifiedPage(locale, businessName))
    }

    // COMPARE AND SET. The address is part of the filter, not merely of the
    // check above, so that a save landing between the read and this write
    // cannot have its new (unverified) address stamped by a link that was
    // issued for the old one. Zero rows back means exactly that race, and it
    // renders the neutral page: nothing was verified, so nothing is claimed.
    //
    // The value in the filter is the one we just read out of our own row, not
    // anything a caller supplied, which is why an address is allowed into a
    // filter string here at all (compare concierge-followup-unsubscribe's
    // header, where it never is: there the address comes from a visitor).
    const { data: updated, error: updateErr } = await admin
      .from(TABLE)
      .update({ followup_reply_to_verified_at: deps.now().toISOString() })
      .eq('id', claim.conciergeId)
      .eq('followup_reply_to', current)
      .select('id')

    if (updateErr) {
      console.error('concierge-followup-verify-reply-to: stamp failed', updateErr)
      // Never claim a verification we did not record: the send path would then
      // be blocked while the coach believes it is unblocked.
      return neutral()
    }
    if (!updated || (updated as unknown[]).length === 0) return neutral()

    return consentPageResponse(renderReplyToVerifiedPage(locale, businessName))
  } catch (e) {
    // Nothing above is allowed to reach here, which is exactly why it exists.
    console.error('concierge-followup-verify-reply-to: unhandled', e)
    return consentPageResponse(renderReplyToVerifyNeutralPage(neutralLocale))
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleVerifyReplyTo(req))
}
