// concierge-followup-unsubscribe: the one-click withdrawal every follow-up mail
// promises.
//
//   GET  /concierge-followup-unsubscribe?t=v1.<concierge>.<conversation>.<sig>
//   POST /concierge-followup-unsubscribe?t=...      (RFC 8058 One-Click)
//   POST /concierge-followup-unsubscribe?t=...&undo=1
//
// The consent notice the recipient read (consent.ts) says, in the text we will
// one day have to produce in evidence: "Du kannst jederzeit widerrufen, mit
// einem Klick am Ende der E-Mail." This endpoint is that click. Without it the
// mail is an unsolicited advertisement under §7 Abs. 2 Nr. 3 UWG from the
// second sentence of its own footer onwards.
//
// IT RUNS UNAUTHENTICATED. Someone clicking out of a mail client carries no
// JWT, so config.toml sets verify_jwt = false and the security model is the
// signed token (followupToken.ts). Same doorman argument as the confirm
// endpoint: a forged `t` is refused by arithmetic, before an admin client is
// constructed, so the endpoint is not a free "does this conversation exist"
// oracle and cannot be turned into database load.
//
// -----------------------------------------------------------------------
// GET ACTS IMMEDIATELY, AND THAT IS THE OPPOSITE OF THE CONFIRM ENDPOINT
// -----------------------------------------------------------------------
//
// concierge-consent-confirm REFUSES HEAD and takes the write path only on GET,
// because Outlook Safe Links, Proofpoint and Mimecast prefetch every URL in an
// inbound mail: there, a prefetch that took the write path would FABRICATE A
// CONSENT and file it, permanently, into an append-only evidence ledger as
// proof that a human clicked.
//
// Here the misfire points the other way. The only thing a prefetch can cause is
// that a mail is NOT sent. Nobody's rights are damaged by a follow-up that
// stays unsent; the coach loses a lead, and a lost lead is a business cost,
// not a legal one. So GET acts, HEAD acts, and neither is second-guessed:
// making the recipient click twice to escape would trade a real §7 exposure for
// a commercial convenience, in that order of importance.
//
// The undo (below) is what pays for that choice. It is POST-only precisely
// because it points in the dangerous direction: a GET undo would be followed by
// the same prefetchers, and mail we were told to stop sending would resume on
// its own.
//
// -----------------------------------------------------------------------
// RFC 8058 ONE-CLICK
// -----------------------------------------------------------------------
//
// Gmail and Outlook render their own "unsubscribe" affordance when a mail
// carries `List-Unsubscribe` plus `List-Unsubscribe-Post: List-Unsubscribe=
// One-Click` (built by followupToken.ts), and they POST to the URL with that
// body. The recipient never sees our page, so the response body does not
// matter and the status does. Any POST that is not an explicit undo is treated
// as an unsubscribe, whatever the body says: a POST arriving at a withdrawal
// URL from anywhere at all is a request to stop sending mail, and the safe
// reading of an ambiguous one is the one where no mail goes out.
//
// -----------------------------------------------------------------------
// NEVER A POSTREST FILTER BUILT AROUND AN ADDRESS
// -----------------------------------------------------------------------
//
// The suppression is written by the `concierge_followup_unsubscribe` RPC and
// removed by its `_undo` companion, both of which take the address as a bound
// argument in a JSON body. Nothing here ever puts an address into a filter
// string. isEmail() (concierge-chat) accepts `,`, `(` and `)`, all of which are
// PostgREST syntax; an address holding them, dropped into a filter, is a
// crafted address that reads or deletes rows for OTHER people. Every filter in
// this file takes a UUID that followupToken.ts already matched against a UUID
// regex.
//
// NEVER THROWS. Every path returns a Response, including a database that
// refuses to answer. The visitor is holding a mail client, not a console.
//
// All external effects are injected, so the tests run offline against a
// hand-rolled fake client, exactly like concierge-consent-confirm.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { clampLocale, localeFromAcceptLanguage } from '../_shared/consentPage.ts'
import {
  followupPageResponse,
  renderUnsubscribedPage,
  renderUnsubscribeNeutralPage,
  renderUnsubscribeUndonePage,
} from '../_shared/followupPage.ts'
import {
  UNSUBSCRIBE_TOKEN_PARAM,
  UNSUBSCRIBE_UNDO_PARAM,
  UNSUBSCRIBE_UNDO_VALUE,
  verifyUnsubscribeToken,
} from '../_shared/followupToken.ts'

const CONSENTS_TABLE = 'concierge_consents'

// Files the suppression. Signature: (p_concierge_id uuid, p_email text,
// p_source text). It owns the write, so that "suppressed" is one transaction
// the database defines rather than a sequence this isolate hopes it completed.
export const UNSUBSCRIBE_RPC = 'concierge_followup_unsubscribe'

// Removes it again. Its argument list is deliberately SHORTER: there is no
// p_source, because an undo files no consent and asserts nothing about who the
// recipient is. It is the withdrawal of a withdrawal, not a new opt-in.
//
// It is an RPC and not a `.delete().eq('email', ...)` for the reason in the
// header: an address must never reach a filter string. If the migration has not
// shipped it yet, the call errors, the neutral page renders, and the
// suppression STAYS. That is the correct way for this to break.
export const UNSUBSCRIBE_UNDO_RPC = 'concierge_followup_unsubscribe_undo'

// consent.ts's ConsentSource for exactly this act.
const UNSUBSCRIBE_SOURCE = 'visitor_unsubscribe'

export interface FollowupUnsubscribeDeps {
  createAdminClient: () => SupabaseClient
  env: (key: string) => string | undefined
}

const defaultDeps: FollowupUnsubscribeDeps = {
  createAdminClient,
  env: (key) => Deno.env.get(key),
}

interface ConsentIdentity {
  visitor_email_norm: string
  locale: string
  rendered_business_name: string
}

export async function handleFollowupUnsubscribe(
  req: Request,
  deps: FollowupUnsubscribeDeps = defaultDeps,
): Promise<Response> {
  // Built from the browser's own Accept-Language, never from a lookup. It is
  // the answer to every failure, so it has to be reachable knowing nothing.
  const neutralLocale = localeFromAcceptLanguage(req.headers.get('accept-language'))
  const head = req.method === 'HEAD'
  const neutral = (status = 200) =>
    followupPageResponse(renderUnsubscribeNeutralPage(neutralLocale), status, head)

  try {
    // No CORS. This URL is navigated to by a browser or POSTed to by a mail
    // provider, never fetched cross-origin, so it needs no Access-Control
    // headers and grants none.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
      return neutral(405)
    }

    const secret = deps.env('FOLLOWUP_UNSUB_SECRET') ?? ''
    // The rotation fallback. See followupToken.ts: without it, the moment the
    // secret is rotated every unsubscribe link already sitting in an inbox
    // stops working, which is this endpoint's own failure mode reached through
    // ops.
    const previousSecret = deps.env('FOLLOWUP_UNSUB_SECRET_PREVIOUS') ?? ''
    if (!secret && !previousSecret) {
      console.error('concierge-followup-unsubscribe: FOLLOWUP_UNSUB_SECRET is not set')
      return neutral()
    }

    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return neutral()
    }

    // An undo is POST-only, and only with the explicit flag. A GET carrying
    // undo=1 unsubscribes like any other GET: see the header for why the
    // dangerous direction is not allowed to be prefetchable.
    const undo = req.method === 'POST' &&
      url.searchParams.get(UNSUBSCRIBE_UNDO_PARAM) === UNSUBSCRIBE_UNDO_VALUE

    // Everything up to here has touched no database. A forged or truncated `t`
    // stops on this line, having cost at most two HMACs, and no admin client is
    // ever constructed.
    const claim = await verifyUnsubscribeToken(
      url.searchParams.get(UNSUBSCRIBE_TOKEN_PARAM),
      secret,
      previousSecret,
    )
    if (!claim) return neutral()

    let admin: SupabaseClient
    try {
      admin = deps.createAdminClient()
    } catch (e) {
      console.error('concierge-followup-unsubscribe: admin client unavailable', e)
      return neutral()
    }

    // Resolve the address the token stands for. The token carries the pair of
    // UUIDs and not the address itself (see followupToken.ts), so this read is
    // what turns one into the other. Both filters are UUIDs the token module
    // already matched against a UUID regex.
    //
    // Newest row wins: a visitor who resubmitted the contact form with a
    // corrected address has two rows here, and the one they last stood behind
    // is the one to act on. A withdrawal row filed by an earlier click carries
    // the same address, so the undo resolves to it too.
    const { data, error } = await admin
      .from(CONSENTS_TABLE)
      .select('visitor_email_norm, locale, rendered_business_name')
      .eq('concierge_id', claim.conciergeId)
      .eq('conversation_id', claim.conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('concierge-followup-unsubscribe: identity lookup failed', error)
      return neutral()
    }
    if (!data) return neutral()

    const identity = data as unknown as ConsentIdentity
    const email = (identity.visitor_email_norm ?? '').trim()
    if (!email) return neutral()

    const locale = clampLocale(identity.locale)
    const businessName = identity.rendered_business_name ?? ''

    if (undo) {
      const { error: undoErr } = await admin.rpc(UNSUBSCRIBE_UNDO_RPC, {
        p_concierge_id: claim.conciergeId,
        p_email: email,
      })
      if (undoErr) {
        console.error('concierge-followup-unsubscribe: undo failed', undoErr)
        // The suppression stands. Saying "undone" when it is not would be the
        // one lie that puts mail back into an inbox that asked for none.
        return neutral()
      }
      return followupPageResponse(renderUnsubscribeUndonePage(locale, businessName), 200, head)
    }

    const { error: rpcErr } = await admin.rpc(UNSUBSCRIBE_RPC, {
      p_concierge_id: claim.conciergeId,
      p_email: email,
      p_source: UNSUBSCRIBE_SOURCE,
    })
    if (rpcErr) {
      console.error('concierge-followup-unsubscribe: unsubscribe failed', rpcErr)
      // Never claim a withdrawal we did not record. The neutral page carries
      // the reply-to-the-mail route for exactly this case.
      return neutral()
    }

    // The undo form posts back to THIS path, built from our own URL rather than
    // from any configured origin, so the page stays on whatever host served it
    // and `form-action 'self'` is satisfiable. A One-Click POST gets no form:
    // no human is reading that response.
    const undoAction = req.method === 'POST' ? undefined : undoActionFor(url)

    return followupPageResponse(
      renderUnsubscribedPage(locale, businessName, undoAction),
      200,
      head,
    )
  } catch (e) {
    // Nothing above is allowed to reach here, which is why it exists.
    console.error('concierge-followup-unsubscribe: unhandled', e)
    return followupPageResponse(renderUnsubscribeNeutralPage(neutralLocale), 200, head)
  }
}

// Path and query only. An absolute URL here would pin the form to the host the
// function happens to see behind the proxy, which is not the host the recipient
// is looking at.
function undoActionFor(url: URL): string {
  const action = new URL(url.toString())
  action.hash = ''
  action.searchParams.set(UNSUBSCRIBE_UNDO_PARAM, UNSUBSCRIBE_UNDO_VALUE)
  return `${action.pathname}${action.search}`
}

if (import.meta.main) {
  Deno.serve((req) => handleFollowupUnsubscribe(req))
}
