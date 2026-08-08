// Permission for the SETTER TO SAY that a follow-up email is coming.
//
// This module answers exactly one question: at this moment, in this
// conversation, would the sentence "you will get an email about this" be TRUE?
// Nothing here sends anything. It exists because the concierge prompt used to
// carry a flat prohibition ("you CANNOT have someone follow up"), and that
// prohibition was correct for as long as no follow-up existed. Now one does, and
// a bot that still refuses to mention it is telling the visitor something false
// in the other direction: they ticked a box, they confirmed a mail, and the bot
// pretends nothing will happen.
//
// So the prohibition lifts -- but only against evidence, and only in the exact
// cases where the dispatcher will really send.
//
// THE ONE RULE THIS MODULE OBEYS: NEVER BE LOOSER THAN THE SENDER.
//
// concierge-followup-send/decide.ts is the thing that actually decides whether a
// queued mail leaves the building. Every one of its `cancel` reasons is a case
// where a promise made in the chat would become a lie two hours later, with the
// visitor waiting for a mail that was silently killed. So every cancel reason in
// decide.ts has a denial reason here, checked in the same spirit and in the same
// direction (fail closed). Being STRICTER than decide.ts is fine: the cost is a
// bot that stays quiet about a mail that does arrive, which is a small
// disappointment. Being LOOSER is a lie.
//
// decide.ts's `defer` reasons are handled the same way. A deferral is not a
// cancel, but a paused sender that stays paused defers until the row expires and
// is then cancelled -- so from the visitor's side it is indistinguishable.
//
// WHY THE RETURN TYPE IS BRANDED
//
// The point of a grant is that HOLDING ONE IS PROOF. A plain discriminant --
// `{ kind: 'follow_up_grant' }` -- proves nothing, because any caller anywhere
// can type those characters into an object literal and satisfy the type. The
// brand below is a module-private `unique symbol`: it cannot be named outside
// this file, so it cannot appear in an object literal outside this file, so the
// ONLY way to obtain a FollowUpGrant is to call resolveFollowUpGrant and pass
// every check. That is what makes "the prompt takes a grant" a real constraint
// rather than a naming convention.

import { type ConsentState, maySendFollowup, normalizeConsentEmail } from './consent.ts'
import { isEntitledToServe } from './entitlement.ts'

// ---------------------------------------------------------------------------
// The honesty switch
// ---------------------------------------------------------------------------

// FALSE UNTIL A REAL FOLLOW-UP MAIL HAS BEEN SENT AND RECEIVED, END TO END.
//
// Everything downstream of this file is built and green, and none of it has ever
// delivered a message to a human being. Until it has, the bot must not say a
// mail is coming, because nobody can yet state from experience that one does.
// Specifically, all of these are still open at the time of writing:
//
//   * concierges.followup_reply_to_verified_at is written by NOTHING. The
//     verification round-trip does not exist, so decide.ts cancels every row
//     with `reply_to_unverified` (see its rule 3).
//   * concierge_followup_ops.sending_enabled ships FALSE
//     (20260812100000, section 3), so the claim function returns no work at all.
//
// FLIP THIS TO TRUE ONLY AFTER a follow-up mail has actually landed in a real
// inbox and been read there -- not after the tests pass, not after the switch is
// flipped, not after a staging dry run. This constant is the difference between
// a bot that describes a feature and a bot that describes reality.
export const FOLLOW_UP_SENDER_SHIPPED = false

// How old a confirmed consent may be before the bot stops treating it as live.
//
// Six months, counted as 183 days so the rule needs no calendar arithmetic and
// no timezone. This is NOT a legal deadline -- §7 UWG sets none -- it is the
// point past which a visitor plainly no longer expects a mail because of a
// checkbox they ticked half a year ago. The queue's own TTL is 72 hours
// (FOLLOWUP_TTL_MS in concierge-chat/index.ts), so in practice a consent this
// old belongs to a conversation that never armed anything; saying a mail is
// coming on the strength of it would be a promise about a queue row that does
// not exist.
export const CONSENT_MAX_AGE_MS = 183 * 24 * 60 * 60 * 1000

// How far into the future a consent timestamp may sit before it is refused.
//
// The stamp comes from the database clock and `now` comes from the isolate's, so
// a small disagreement is normal and must not deny a real consent. A LARGE one
// is not clock skew, it is a stamp that was written wrong or written by
// something we do not control, and a consent dated next Tuesday cannot be
// evidence of a thing that already happened.
export const CONSENT_FUTURE_SKEW_MS = 60 * 1000

// ---------------------------------------------------------------------------
// The branded grant
// ---------------------------------------------------------------------------

// NOT EXPORTED, and that is the entire mechanism. TypeScript will not let an
// object literal in another module carry a symbol key it cannot name, so
// `const forged: FollowUpGrant = { ... }` does not compile anywhere but here.
const FOLLOW_UP_GRANT_BRAND: unique symbol = Symbol('2fronts.followUpGrant')

export interface FollowUpGrant {
  // The brand. Present only on objects this module built.
  readonly [FOLLOW_UP_GRANT_BRAND]: true
  // The address the mail will actually go to (normalised). Carried so a caller
  // that wants to name it, or log it, does not have to re-derive which of the
  // two addresses in play won.
  readonly recipientEmail: string
  // When the consent this grant rests on was confirmed. Carried for the same
  // reason: a grant should be able to say what it is evidence of.
  readonly consentConfirmedAt: string
}

// The runtime half of the brand. A forged object reaching a function at runtime
// -- through `as`, through JSON, through an `any` -- is not stopped by the type
// system, and the prompt builder must be able to refuse it. Never widen this to
// a structural check.
export function isFollowUpGrant(value: unknown): value is FollowUpGrant {
  if (typeof value !== 'object' || value === null) return false
  return (value as Record<symbol, unknown>)[FOLLOW_UP_GRANT_BRAND] === true
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

// The sender-side facts. Deliberately the same column set decide.ts reads off
// the concierge row, so the two can be compared field by field in review.
export interface FollowUpGrantSender {
  is_active?: boolean | null
  is_demo?: boolean | null
  demo_expires_at?: string | null
  entitled_until?: string | null
  calendar_url?: string | null
  followup_enabled?: boolean | null
  followup_sender_ack_at?: string | null
  followup_sender_block?: string | null
  followup_privacy_url?: string | null
  followup_reply_to?: string | null
  followup_reply_to_verified_at?: string | null
}

export interface FollowUpGrantInput {
  concierge: FollowUpGrantSender | null
  // Derived from the append-only ledger with effectiveConsentState().
  consentState: ConsentState
  // The address the consent was actually given for, and when it was confirmed.
  consentEmail: string | null
  consentConfirmedAt: string | null
  // The conversation's CURRENT visitor_email. Compared against consentEmail
  // because concierge_conversations.visitor_email is overwritten by any later
  // contact submission while the consent stamp is not -- so a visitor who
  // corrects a typo would otherwise have their old consent re-pointed at a
  // stranger's mailbox, and the bot would promise that stranger's inbox a mail.
  // decide.ts rule 4 makes exactly this comparison before sending.
  visitorEmail: string | null
  // Operational facts the bot cannot see from the conversation, each one a
  // decide.ts cancel. REQUIRED, not optional with a permissive default: a caller
  // who has not looked them up must not accidentally get a grant.
  suppressed: boolean
  alreadyMailed: boolean
  // concierge_followup_ops.sending_enabled. Not a decide.ts rule -- it is
  // upstream of it, in concierge_followup_claim() -- but a queue that is never
  // claimed sends nothing, so the promise is just as false.
  sendingEnabled: boolean
  now: Date
}

// Every way the answer can be no. One per decide.ts cancel/defer reason, plus
// the three this module adds (not shipped, no visitor address, stale consent).
export type FollowUpGrantDenial =
  | 'sender_not_shipped'
  | 'concierge_missing'
  | 'is_demo'
  | 'followup_switched_off'
  | 'not_entitled'
  | 'sender_inactive'
  | 'no_sender_ack'
  | 'no_sender_block'
  | 'no_privacy_url'
  | 'no_reply_to'
  | 'reply_to_unverified'
  | 'no_calendar_url'
  | 'consent_none'
  | 'consent_granted'
  | 'consent_withdrawn'
  | 'consent_unparseable'
  | 'consent_stale'
  | 'consent_in_future'
  | 'no_visitor_email'
  | 'consent_email_mismatch'
  | 'suppressed'
  | 'already_mailed'
  | 'sending_disabled'

export interface FollowUpGrantResult {
  grant: FollowUpGrant | null
  reason: 'ok' | FollowUpGrantDenial
}

function present(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim() !== ''
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

// Same shape and spirit as decideSend: first denial wins, and each check says
// why it is where it is. Returns the reason as well as the grant so a caller can
// log WHY the bot stayed quiet -- "no grant" is otherwise indistinguishable from
// "nobody asked", and that difference is the whole debugging story when a coach
// reports that their setter never mentions the mail.
export function resolveFollowUpGrantResult(
  input: FollowUpGrantInput,
  // TEST SEAM. Production passes nothing and gets FOLLOW_UP_SENDER_SHIPPED.
  //
  // It exists because that constant is false, so without an override EVERY
  // negative test below would pass for the wrong reason -- vacuously, on the
  // first line -- and would keep passing after somebody deleted the rule it
  // claims to test. Overriding it in production code would be a way to make the
  // bot promise a mail the pipeline cannot send; there is exactly one caller
  // allowed to pass it, and it is followUpGrant.test.ts.
  senderShipped: boolean = FOLLOW_UP_SENDER_SHIPPED,
): FollowUpGrantResult {
  const deny = (reason: FollowUpGrantDenial): FollowUpGrantResult => ({ grant: null, reason })

  // 0. NOT SHIPPED. First, because it is not a fact about this visitor at all --
  //    it is a statement that nobody has ever watched one of these mails arrive.
  //    Nothing below can make that true.
  if (senderShipped !== true) return deny('sender_not_shipped')

  const c = input.concierge
  if (!c) return deny('concierge_missing')

  // 1. DEMO, before entitlement, exactly as decide.ts rule 2 orders it:
  //    isEntitledToServe returns TRUE for an in-date demo, and a demo speaks in a
  //    real person's business name without their agreement. A demo may chat. It
  //    may not mail, and it may not say it will.
  if (c.is_demo === true) return deny('is_demo')

  // 2. THE COACH'S SWITCH. decide.ts defers on this rather than cancelling,
  //    because a coach who pauses for an afternoon should not lose their queue.
  //    Here it denies outright: the question is what is true NOW, and right now
  //    the coach has said they do not want these mails going out.
  if (c.followup_enabled !== true) return deny('followup_switched_off')
  if (c.is_active === false) return deny('sender_inactive')
  if (!isEntitledToServe(c, input.now)) return deny('not_entitled')

  // 3. SENDER IDENTITY -- decide.ts rule 3, field for field. §5 DDG wants a real
  //    reachable sender, Art. 13 DSGVO wants the privacy notice, and the coach
  //    has to have accepted being that sender. A mail missing any of these is
  //    cancelled, so a promise of it is a lie.
  if (!present(c.followup_sender_ack_at)) return deny('no_sender_ack')
  if (!present(c.followup_sender_block)) return deny('no_sender_block')
  if (!present(c.followup_privacy_url)) return deny('no_privacy_url')
  if (!present(c.followup_reply_to)) return deny('no_reply_to')
  // VERIFIED, not merely typed into a wizard. A typo here means the coach never
  // sees a single reply to a mail carrying their own name. NOTHING writes this
  // column today (see FOLLOW_UP_SENDER_SHIPPED), so this is the rule that would
  // stop the bot even if the shipped flag were flipped early.
  if (!present(c.followup_reply_to_verified_at)) return deny('reply_to_unverified')
  // The booking link is the ENTIRE payload of the follow-up mail. Without one
  // there is no message to promise.
  if (!present(c.calendar_url)) return deny('no_calendar_url')

  // 4. CONSENT. 'granted' is deliberately not enough: a ticked box only proves
  //    somebody typed that address, not that they own it. Confirming the mail is
  //    what ties it to a person, and that is the whole point of double opt-in.
  if (!maySendFollowup(input.consentState)) {
    if (input.consentState === 'withdrawn') return deny('consent_withdrawn')
    if (input.consentState === 'granted') return deny('consent_granted')
    return deny('consent_none')
  }

  // 5. THE STAMP. A confirmed state with no readable timestamp is not evidence.
  if (!present(input.consentConfirmedAt)) return deny('consent_unparseable')
  const confirmedMs = Date.parse(input.consentConfirmedAt as string)
  if (!Number.isFinite(confirmedMs)) return deny('consent_unparseable')
  const nowMs = input.now.getTime()
  // Future first: a stamp from next week would otherwise sail through the age
  // check (a negative age is never "too old") and look like the freshest
  // consent in the system.
  if (confirmedMs > nowMs + CONSENT_FUTURE_SKEW_MS) return deny('consent_in_future')
  if (nowMs - confirmedMs > CONSENT_MAX_AGE_MS) return deny('consent_stale')

  // 6. THE ADDRESSES MUST MATCH. See visitorEmail's comment: the conversation's
  //    address moves, the consent's does not.
  if (!present(input.visitorEmail)) return deny('no_visitor_email')
  if (!present(input.consentEmail)) return deny('consent_email_mismatch')
  const recipient = normalizeConsentEmail(input.consentEmail as string)
  if (recipient !== normalizeConsentEmail(input.visitorEmail as string)) {
    return deny('consent_email_mismatch')
  }

  // 7. OPERATIONAL, all permanent. Someone who has unsubscribed or bounced is on
  //    the do-not-send list, and the partial unique index in 20260812100000
  //    section 4 means a person who has already been mailed by this sender can
  //    never be mailed again -- that is the "eine einzige E-Mail" promise,
  //    literally. A second promise to either of them is a promise nothing can
  //    keep.
  if (input.suppressed) return deny('suppressed')
  if (input.alreadyMailed) return deny('already_mailed')
  if (!input.sendingEnabled) return deny('sending_disabled')

  return {
    grant: {
      [FOLLOW_UP_GRANT_BRAND]: true,
      recipientEmail: recipient,
      consentConfirmedAt: input.consentConfirmedAt as string,
    },
    reason: 'ok',
  }
}

// The ordinary entry point. Callers that do not care why simply get null.
export function resolveFollowUpGrant(
  input: FollowUpGrantInput,
  senderShipped: boolean = FOLLOW_UP_SENDER_SHIPPED,
): FollowUpGrant | null {
  return resolveFollowUpGrantResult(input, senderShipped).grant
}
