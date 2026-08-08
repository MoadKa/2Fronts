// concierge-consent-confirm: the click at the end of the double opt-in.
//
// GET /functions/v1/concierge-consent-confirm?t=<confirm_token>.<signature>
//
// The visitor ticked a box on /c/<slug>, which filed a `granted` row in
// concierge_consents (see _shared/consent.ts). A ticked box only proves that
// whoever sat at the keyboard typed that address. This endpoint is where the
// owner of the mailbox says "yes, that was me", and it files the one row that
// maySendFollowup() will ever accept: action 'confirmed', source
// 'visitor_confirmation'.
//
// IT RUNS UNAUTHENTICATED. A visitor clicking a link in a mail carries no JWT,
// so config.toml sets verify_jwt = false and the whole security model is the
// token. What that means, and what it does NOT mean:
//
//   1. THE SIGNATURE IS A DOORMAN FOR THE DATABASE. `t` is the row's
//      confirm_token plus an HMAC of it under CONSENT_CONFIRM_SECRET. Anything
//      that fails the HMAC is refused before a client is even constructed, so
//      an attacker enumerating tokens cannot make us run one query, cannot
//      raise our database load, and cannot use response timing to learn which
//      guesses exist. Without the signature this endpoint would be a free
//      "does this token exist" oracle for anyone with a socket.
//
//   2. THE NEUTRAL PAGE NEVER SAYS WHICH FAILURE HAPPENED. Unknown, expired,
//      truncated, already withdrawn, database down: one page, one status, one
//      set of headers. See renderNeutralPage's comment in consentPage.ts.
//
//   3. THE WORST AN ATTACKER WITH A STOLEN TOKEN CAN DO IS CONFIRM A CONSENT
//      THE VISITOR ALREADY GAVE. There is nothing else behind this endpoint:
//      it reads no offer, exposes no address, returns no row, and the only
//      write it performs is a copy of a snapshot that already exists. It
//      cannot create a consent, only ratify one that a `granted` row already
//      proves. The token reaches only the mailbox that the consent is for, so
//      "the attacker" here is someone who already reads the visitor's mail.
//
//   4. IT CANNOT RESURRECT A WITHDRAWN CONSENT. A visitor who withdrew after
//      granting, and whose old confirm link is then clicked (by them, by a
//      scanner, by anyone), does not come back. We derive the current state
//      with effectiveConsentState() and refuse to file over a withdrawal.
//
//   5. A LINK SCANNER'S GET IS INDISTINGUISHABLE FROM A HUMAN'S. Corporate mail
//      security and mail clients prefetch links, so this endpoint MUST be
//      idempotent, and it is (see below). It also means a confirmation can be
//      recorded by a scanner rather than by the visitor. That is inherent to
//      link-based double opt-in; we mitigate it only by recording the click's
//      own IP and user agent alongside the row, so such an artefact can be
//      recognised later. Turning the page into a POST form would remove it, at
//      the cost of a second click, and is deliberately not what this step does.
//
// IDEMPOTENCY. Before inserting, we read the ledger for this subject key
// (concierge_id + visitor_email_norm) and derive the state. Already
// 'confirmed' means the second click renders exactly the same success page and
// writes nothing. A unique-violation on the insert (23505) is also treated as
// success, so the day a partial unique index lands on
// (concierge_id, visitor_email_norm) where action = 'confirmed', this code is
// already correct. Until that index exists, two genuinely simultaneous
// prefetches could file two identical 'confirmed' rows; effectiveConsentState
// reads them as one 'confirmed', so the legal state is unaffected and the only
// cost is a duplicate line in the evidence.
//
// Do NOT read that as "add the index". A partial unique index on
// (concierge_id, visitor_email_norm) where action = 'confirmed' would make a
// lawful withdraw -> re-grant -> re-confirm cycle fail permanently, because the
// first 'confirmed' row never goes away: the ledger is append-only by design.
// Getting a duplicate evidence line is the cheaper of the two failures. If the
// duplicate ever matters, dedupe on read, not with a constraint.
//
// NEVER THROWS. Every path, including a database that refuses to answer,
// returns a Response. The visitor is holding a mail client, not a console.
//
// All external effects are injected, so the tests run offline against a
// hand-rolled fake client, exactly like confirm-mapping and intake.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import {
  CONSENT_IP_MAX,
  CONSENT_UA_MAX,
  type ConsentLedgerEntry,
  effectiveConsentState,
} from '../_shared/consent.ts'
import { CONFIRM_TOKEN_PARAM, verifyConfirmToken } from '../_shared/consentMail.ts'
import {
  clampLocale,
  consentPageResponse,
  localeFromAcceptLanguage,
  renderConfirmedPage,
  renderNeutralPage,
} from '../_shared/consentPage.ts'

const TABLE = 'concierge_consents'
const UNIQUE_VIOLATION = '23505'

// How far back the ledger read goes. A subject key holds a handful of rows in
// practice (grant, confirm, maybe a withdrawal); the cap only stops a pathological
// row count from turning one click into a large read.
const LEDGER_LIMIT = 100

// The snapshot columns. Copied verbatim onto the confirmed row: the point of the
// ledger is that a stored row reproduces what the visitor actually read, so this
// endpoint must never rebuild the wording from consent.ts. Rebuilding would file
// today's text against yesterday's consent, which proves nothing.
const GRANTED_COLUMNS = [
  'id',
  'concierge_id',
  'conversation_id',
  'sender_owner_id',
  'visitor_email',
  'visitor_email_norm',
  'notice_version',
  'notice_label',
  'notice_text',
  'rendered_business_name',
  'locale',
  'confirm_token_expires_at',
].join(', ')

interface GrantedRow {
  id: string
  concierge_id: string
  conversation_id: string | null
  sender_owner_id: string | null
  visitor_email: string
  visitor_email_norm: string
  notice_version: string
  notice_label: string
  notice_text: string
  rendered_business_name: string
  locale: string
  confirm_token_expires_at: string | null
}

export interface ConsentConfirmDeps {
  createAdminClient: () => SupabaseClient
  env: (key: string) => string | undefined
  now: () => Date
}

const defaultDeps: ConsentConfirmDeps = {
  createAdminClient,
  env: (key) => Deno.env.get(key),
  now: () => new Date(),
}

function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  const raw = fwd ? fwd.split(',')[0].trim() : (req.headers.get('x-real-ip')?.trim() ?? '')
  if (!raw) return null
  return raw.slice(0, CONSENT_IP_MAX)
}

function userAgent(req: Request): string | null {
  const raw = req.headers.get('user-agent')?.trim()
  if (!raw) return null
  return raw.slice(0, CONSENT_UA_MAX)
}

export async function handleConsentConfirm(
  req: Request,
  deps: ConsentConfirmDeps = defaultDeps,
): Promise<Response> {
  // The neutral page is built from the browser's own Accept-Language, never
  // from anything we would have to look up. It is the answer to every failure,
  // so it must be reachable without knowing anything at all.
  const neutralLocale = localeFromAcceptLanguage(req.headers.get('accept-language'))
  const neutral = (status = 200) => consentPageResponse(renderNeutralPage(neutralLocale), status)

  try {
    // A browser follows a link with GET; HEAD is what some scanners send. Both
    // read the same page, and neither is allowed to be answered with anything
    // that admits the token exists. No CORS: this URL is navigated to, never
    // fetched cross-origin, so it needs no Access-Control headers and grants
    // none.
    if (req.method !== 'GET' && req.method !== 'HEAD') return neutral(405)

    // HEAD NEVER CONFIRMS.
    //
    // Outlook Safe Links, Proofpoint and Mimecast issue HEAD against every URL
    // in an inbound mail as a matter of course. Letting HEAD take the write path
    // files an `action='confirmed'` row, permanently, into an append-only
    // evidence ledger for a click no human ever made — a consent we would then
    // present as proof. GET carries the same prefetch risk and is accepted
    // anyway, because a human clicking really does produce a GET and refusing it
    // would drop lawful consents; there is no such argument for HEAD, which no
    // browser navigation emits. Answer the neutral page and touch nothing.
    if (req.method === 'HEAD') {
      return consentPageResponse(renderNeutralPage(neutralLocale), 200)
    }

    const secret = deps.env('CONSENT_CONFIRM_SECRET') ?? ''
    if (!secret) {
      // Fail closed and say so in the logs. Without the secret no link we ever
      // sent can be confirmed, which is a deployment fault, not a visitor one.
      console.error('concierge-consent-confirm: CONSENT_CONFIRM_SECRET is not set')
      return neutral()
    }

    let raw: string | null
    try {
      raw = new URL(req.url).searchParams.get(CONFIRM_TOKEN_PARAM)
    } catch {
      return neutral()
    }

    // Everything up to here has touched no database. A forged or truncated `t`
    // stops at this line, having cost one HMAC.
    const confirmToken = await verifyConfirmToken(raw, secret)
    if (!confirmToken) return neutral()

    let admin: SupabaseClient
    try {
      admin = deps.createAdminClient()
    } catch (e) {
      console.error('concierge-consent-confirm: admin client unavailable', e)
      return neutral()
    }

    // Read 1: the granted row this token belongs to.
    const { data: granted, error: grantedErr } = await admin
      .from(TABLE)
      .select(GRANTED_COLUMNS)
      .eq('confirm_token', confirmToken)
      .eq('action', 'granted')
      .limit(1)
      .maybeSingle()

    if (grantedErr) {
      console.error('concierge-consent-confirm: lookup failed', grantedErr)
      return neutral()
    }
    if (!granted) return neutral()

    const row = granted as unknown as GrantedRow

    // Expiry is checked here rather than in the query so that "no such token"
    // and "token ran out" cost the same one query and produce the same page.
    const expiresAt = row.confirm_token_expires_at
    if (expiresAt) {
      const expiry = Date.parse(expiresAt)
      // An unparseable expiry is treated as expired: an evidence row whose
      // deadline we cannot read is not one to act on.
      if (!Number.isFinite(expiry) || expiry <= deps.now().getTime()) return neutral()
    }

    const locale = clampLocale(row.locale)

    // Read 2: the ledger for this subject key. Two jobs at once — idempotency
    // (is there already a confirmation?) and the withdrawal guard (has this
    // person taken it back since?).
    const { data: ledger, error: ledgerErr } = await admin
      .from(TABLE)
      .select('action, created_at')
      .eq('concierge_id', row.concierge_id)
      .eq('visitor_email_norm', row.visitor_email_norm)
      .order('created_at', { ascending: false })
      .limit(LEDGER_LIMIT)

    if (ledgerErr) {
      console.error('concierge-consent-confirm: ledger read failed', ledgerErr)
      return neutral()
    }

    const entries = (ledger ?? []) as ConsentLedgerEntry[]
    const state = effectiveConsentState(entries)

    if (state === 'confirmed') {
      // Second click, prefetch, or a replay. Same page, no write.
      return consentPageResponse(renderConfirmedPage(locale, row.rendered_business_name))
    }
    if (state === 'withdrawn') {
      // The visitor took it back after granting. An old confirm link must not
      // undo that, and telling them "confirmed" would be a lie about what we
      // are now allowed to do.
      console.warn('concierge-consent-confirm: refused to confirm over a withdrawal')
      return neutral()
    }
    if (state !== 'granted') {
      // No live grant behind this token. Nothing to ratify.
      return neutral()
    }

    const { error: insertErr } = await admin.from(TABLE).insert({
      concierge_id: row.concierge_id,
      conversation_id: row.conversation_id,
      sender_owner_id: row.sender_owner_id,
      visitor_email: row.visitor_email,
      visitor_email_norm: row.visitor_email_norm,
      action: 'confirmed',
      source: 'visitor_confirmation',
      channel: 'email',
      // The snapshot, carried over unchanged. See GRANTED_COLUMNS.
      notice_version: row.notice_version,
      notice_label: row.notice_label,
      notice_text: row.notice_text,
      rendered_business_name: row.rendered_business_name,
      locale: row.locale,
      // These two describe THIS act, not the grant: they are the evidence of
      // the confirmation itself, and the only way to tell a human's click from
      // a scanner's later on.
      visitor_ip: clientIp(req),
      visitor_user_agent: userAgent(req),
      // No created_at: the database owns the timestamp.
    })

    if (insertErr) {
      const code = (insertErr as { code?: string }).code
      if (code !== UNIQUE_VIOLATION) {
        console.error('concierge-consent-confirm: insert failed', insertErr)
        // We must not claim a confirmation we did not record.
        return neutral()
      }
      // A unique index caught a concurrent click. The row exists; that is the
      // outcome we wanted.
    }

    return consentPageResponse(renderConfirmedPage(locale, row.rendered_business_name))
  } catch (e) {
    // Nothing above is allowed to reach here, which is exactly why it exists.
    console.error('concierge-consent-confirm: unhandled', e)
    return consentPageResponse(renderNeutralPage(neutralLocale))
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleConsentConfirm(req))
}
