// The dispatcher's decision, as a pure function.
//
// Split out from the endpoint on purpose: this is the part with the real rules,
// and rules that decide whether a commercial email goes out in a named person's
// business name deserve to be testable without a database, a clock or a network.
//
// FIRST MATCH WINS AND THE ORDER IS LOAD-BEARING. Each rule below explains why
// it sits where it does. Reordering them changes who gets mail.

import { type ConsentState, maySendFollowup } from '../_shared/consent.ts'
import { isEntitledToServe } from '../_shared/entitlement.ts'

export type SendDecision =
  // Send it now.
  | { action: 'send' }
  // Never send this row; write the reason and stop.
  | { action: 'cancel'; reason: string }
  // Not now, try again later. NEVER a cancel: the queue must survive a coach
  // pausing for a day or a payment lapsing for an afternoon.
  | { action: 'defer'; until: string; reason: string }

export interface OutboxRow {
  id: string
  concierge_id: string
  email_normalized: string
  scheduled_at: string
  expires_at: string
  attempts: number
}

export interface SenderRow {
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

export interface DecideInput {
  row: OutboxRow
  concierge: SenderRow | null
  consentState: ConsentState
  // The address the consent was actually given for. Compared to the row's own,
  // because `visitor_email` on a conversation is overwritten by any later
  // contact submission while the consent stamp is not.
  consentEmail: string | null
  suppressed: boolean
  alreadyMailed: boolean
  now: Date
  // Local hour in the recipient's assumed timezone. Passed in rather than
  // computed, so the caller owns the timezone question and this stays pure.
  localHour: number
}

// A follow-up is a message from a business, so it keeps business hours. Outside
// them it waits. This is courtesy rather than law, but a mail that lands at
// 03:40 reads as automation, and the entire product promise is that it does not.
export const QUIET_START_HOUR = 21
export const QUIET_END_HOUR = 8

// How long to wait when the reason to hold is the COACH's state (paused,
// payment lapsed) rather than the clock. Long enough not to spin, short enough
// that a resolved lapse still catches the visitor while the chat is recent.
export const SENDER_DEFER_MS = 6 * 60 * 60 * 1000

export const MAX_ATTEMPTS = 3

export function decideSend(input: DecideInput): SendDecision {
  const { row, concierge, now } = input
  const nowMs = now.getTime()

  // 1. EXPIRED. Checked first because every other branch is a question about a
  //    mail that might still be worth sending, and this one is not.
  if (nowMs > new Date(row.expires_at).getTime()) {
    return { action: 'cancel', reason: 'expired' }
  }

  if (!concierge) return { action: 'cancel', reason: 'concierge_missing' }

  // 2. DEMO. Before any entitlement logic, because isEntitledToServe returns
  //    TRUE for an in-date demo and there is a live one in production. A demo
  //    speaks in a named real person's business name without their agreement;
  //    mailing prospects in that name is categorically worse than chatting.
  if (concierge.is_demo === true) {
    return { action: 'cancel', reason: 'is_demo' }
  }

  // 3. SENDER IDENTITY. §5 DDG wants a real, reachable sender on commercial
  //    mail, and Art. 13 DSGVO wants the privacy notice. An empty calendar_url
  //    is checked here too: the link is the ENTIRE payload, so a mail without
  //    one is a mail with nothing in it.
  if (!concierge.followup_sender_ack_at) return { action: 'cancel', reason: 'no_sender_ack' }
  if (!concierge.followup_sender_block) return { action: 'cancel', reason: 'no_sender_block' }
  if (!concierge.followup_privacy_url) return { action: 'cancel', reason: 'no_privacy_url' }
  if (!concierge.followup_reply_to) return { action: 'cancel', reason: 'no_reply_to' }
  if (!concierge.calendar_url) return { action: 'cancel', reason: 'no_calendar_url' }

  // 4. CONSENT. Cancel, not defer: a consent that is not confirmed now will not
  //    become confirmed by waiting, and one that was withdrawn must never be
  //    reconsidered.
  if (!maySendFollowup(input.consentState)) {
    return { action: 'cancel', reason: `consent_${input.consentState}` }
  }
  if (!input.consentEmail || input.consentEmail !== row.email_normalized) {
    // The consent belongs to a different address than the one queued. A typo
    // correction on the contact form would otherwise re-point an existing
    // consent at a stranger's mailbox.
    return { action: 'cancel', reason: 'consent_email_mismatch' }
  }

  // 5. SUPPRESSED / ALREADY MAILED. Both permanent.
  if (input.suppressed) return { action: 'cancel', reason: 'suppressed' }
  if (input.alreadyMailed) return { action: 'cancel', reason: 'already_mailed' }

  // 6. THE COACH'S CURRENT STATE — DEFER, NEVER CANCEL.
  //    A paused setter, a flipped switch, a lapsed entitlement: all of these are
  //    normal and temporary. `entitled_until` is a lapsing cache that self-heals
  //    on the next subscription webhook, so cancelling on it would destroy a
  //    queue over a payment that arrives an hour later. Deferring costs a delay;
  //    cancelling is irreversible.
  const senderPaused =
    concierge.is_active === false ||
    concierge.followup_enabled !== true ||
    !isEntitledToServe(concierge, now)
  if (senderPaused) {
    return deferOrExpire(row, nowMs + SENDER_DEFER_MS, 'sender_paused')
  }

  // 7. QUIET HOURS. Last, because it is the only reason that resolves purely
  //    with time and so must not mask a reason that never will.
  if (input.localHour >= QUIET_START_HOUR || input.localHour < QUIET_END_HOUR) {
    const hoursUntilMorning =
      input.localHour >= QUIET_START_HOUR
        ? 24 - input.localHour + QUIET_END_HOUR
        : QUIET_END_HOUR - input.localHour
    return deferOrExpire(row, nowMs + hoursUntilMorning * 60 * 60 * 1000, 'quiet_hours')
  }

  if (nowMs < new Date(row.scheduled_at).getTime()) {
    return { action: 'defer', until: row.scheduled_at, reason: 'not_due' }
  }

  return { action: 'send' }
}

// A deferral that lands past the row's own expiry is not a deferral, it is a
// cancellation that pretends otherwise and leaves a row to be woken up once
// more for nothing. Say so now.
function deferOrExpire(row: OutboxRow, untilMs: number, reason: string): SendDecision {
  const expiresMs = new Date(row.expires_at).getTime()
  if (untilMs >= expiresMs) {
    return { action: 'cancel', reason: `deferred_past_expiry_${reason}` }
  }
  return { action: 'defer', until: new Date(untilMs).toISOString(), reason }
}
