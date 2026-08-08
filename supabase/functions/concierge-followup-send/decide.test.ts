import { assertEquals } from 'jsr:@std/assert@1'
import { isEntitledToServe } from '../_shared/entitlement.ts'
import {
  decideSend,
  type DecideInput,
  MAX_ATTEMPTS,
  type OutboxRow,
  QUIET_END_HOUR,
  QUIET_START_HOUR,
  type SenderRow,
  SENDER_DEFER_MS,
  type SendDecision,
} from './decide.ts'

// ---------------------------------------------------------------------------
// THE HAPPY PATH, ONCE
//
// Every test below starts from `sendable()` — a row that decideSend answers
// 'send' to — and overrides exactly ONE field. That is deliberate: it makes each
// test a statement about a single rule, and it means a reader who wants to know
// what a mailable row looks like reads the helper and nothing else.
//
// The clock is fixed. decideSend takes `now` and `localHour` as arguments
// precisely so tests never depend on when they run.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-06T10:00:00.000Z')

const BASE_ROW: OutboxRow = {
  id: 'outbox-1',
  concierge_id: 'c-1',
  email_normalized: 'anna@example.de',
  // Due half an hour ago.
  scheduled_at: '2026-08-06T09:30:00.000Z',
  // A week of runway, so nothing in these tests bumps into expiry by accident.
  expires_at: '2026-08-13T10:00:00.000Z',
  attempts: 0,
}

const BASE_CONCIERGE: SenderRow = {
  is_active: true,
  is_demo: false,
  demo_expires_at: null,
  entitled_until: '2026-09-01T00:00:00.000Z',
  calendar_url: 'https://cal.com/coach-meyer/30min',
  followup_enabled: true,
  followup_sender_ack_at: '2026-08-01T08:00:00.000Z',
  followup_sender_block: 'Coach Meyer, Musterstr. 1, 45127 Essen',
  followup_privacy_url: 'https://coach-meyer.de/datenschutz',
  followup_reply_to: 'kontakt@coach-meyer.de',
  followup_reply_to_verified_at: '2026-08-01T08:05:00.000Z',
}

type Over =
  & Partial<Omit<DecideInput, 'row' | 'concierge'>>
  & { row?: Partial<OutboxRow>; concierge?: Partial<SenderRow> | null }

function sendable(over: Over = {}): DecideInput {
  const { row, concierge, ...rest } = over
  return {
    row: { ...BASE_ROW, ...row },
    concierge: concierge === null ? null : { ...BASE_CONCIERGE, ...concierge },
    consentState: 'confirmed',
    consentEmail: 'anna@example.de',
    suppressed: false,
    alreadyMailed: false,
    now: NOW,
    localHour: 10,
    ...rest,
  }
}

// A deferral is only a deferral if the row is genuinely recoverable, so every
// defer assertion checks that the wake-up time is in the FUTURE. A defer with a
// past `until` is a busy-loop, and a defer with no `until` is a lost row.
function assertDefer(d: SendDecision, reason: string, now: Date) {
  assertEquals(d.action, 'defer')
  if (d.action !== 'defer') throw new Error('unreachable')
  assertEquals(d.reason, reason)
  assertEquals(new Date(d.until).getTime() > now.getTime(), true)
  return d
}

Deno.test('the happy path: a due, consented, entitled row in business hours sends', () => {
  assertEquals(decideSend(sendable()), { action: 'send' })
})

// ---------------------------------------------------------------------------
// RULE 1 — EXPIRED, AND WHY IT IS FIRST
// ---------------------------------------------------------------------------

Deno.test('rule 1: a row past its expires_at cancels', () => {
  const d = decideSend(sendable({ row: { expires_at: '2026-08-06T09:00:00.000Z' } }))
  assertEquals(d, { action: 'cancel', reason: 'expired' })
})

// The ordering claim, stated as a test. Everything else about this row is also
// wrong — no concierge, a withdrawn consent, suppressed, already mailed, the
// middle of the night — and the answer is still 'expired', because none of those
// questions are worth asking about a mail that may no longer be sent at all.
Deno.test('rule 1: expiry wins over every other failing condition at once', () => {
  const d = decideSend(sendable({
    row: { expires_at: '2026-08-05T00:00:00.000Z' },
    concierge: null,
    consentState: 'withdrawn',
    consentEmail: 'someone-else@example.de',
    suppressed: true,
    alreadyMailed: true,
    localHour: 3,
  }))
  assertEquals(d, { action: 'cancel', reason: 'expired' })
})

// Strictly greater-than: a row whose expiry is exactly now has not expired yet.
Deno.test('rule 1: expires_at exactly equal to now is not yet expired', () => {
  assertEquals(decideSend(sendable({ row: { expires_at: NOW.toISOString() } })), { action: 'send' })
})

Deno.test('rule 1: a missing concierge cancels', () => {
  assertEquals(decideSend(sendable({ concierge: null })), {
    action: 'cancel',
    reason: 'concierge_missing',
  })
})

// ---------------------------------------------------------------------------
// RULE 2 — DEMO, AND WHY IT MUST PRECEDE THE ENTITLEMENT CHECK
// ---------------------------------------------------------------------------

// THE test for the ordering of this file. isEntitledToServe returns TRUE for an
// in-date demo (a demo has no subscription and is bounded by its own expiry
// instead), so a demo check placed after the entitlement check in rule 6 would
// never fire and a live demo would mail prospects in a real person's business
// name. The first assertion below is what makes that concrete.
Deno.test('rule 2: an in-date, fully entitled demo cancels as is_demo, not as anything else', () => {
  const demo: SenderRow = { ...BASE_CONCIERGE, is_demo: true, demo_expires_at: '2026-09-01T00:00:00.000Z' }
  // Entitled by construction — so rule 6 would wave this row through.
  assertEquals(isEntitledToServe(demo, NOW), true)
  assertEquals(decideSend(sendable({ concierge: demo })), { action: 'cancel', reason: 'is_demo' })
})

// And an EXPIRED demo cancels as is_demo too, rather than deferring as a paused
// sender. A demo never becomes mailable by waiting, so a defer here would be a
// row woken up forever.
Deno.test('rule 2: an expired demo still cancels as is_demo, never defers as paused', () => {
  const demo: SenderRow = {
    ...BASE_CONCIERGE,
    is_demo: true,
    demo_expires_at: '2026-07-01T00:00:00.000Z',
    entitled_until: null,
  }
  assertEquals(isEntitledToServe(demo, NOW), false)
  assertEquals(decideSend(sendable({ concierge: demo })), { action: 'cancel', reason: 'is_demo' })
})

// is_demo is checked with === true, so the ordinary customer values (false,
// null, absent) all pass through.
Deno.test('rule 2: is_demo false, null or absent is not a demo', () => {
  assertEquals(decideSend(sendable({ concierge: { is_demo: false } })), { action: 'send' })
  assertEquals(decideSend(sendable({ concierge: { is_demo: null } })), { action: 'send' })
  assertEquals(decideSend(sendable({ concierge: { is_demo: undefined } })), { action: 'send' })
})

// ---------------------------------------------------------------------------
// RULE 3 — SENDER IDENTITY (§5 DDG, Art. 13 DSGVO) AND THE PAYLOAD
// ---------------------------------------------------------------------------

Deno.test('rule 3: no followup_sender_ack_at cancels', () => {
  assertEquals(decideSend(sendable({ concierge: { followup_sender_ack_at: null } })), {
    action: 'cancel',
    reason: 'no_sender_ack',
  })
})

Deno.test('rule 3: no followup_sender_block cancels', () => {
  assertEquals(decideSend(sendable({ concierge: { followup_sender_block: null } })), {
    action: 'cancel',
    reason: 'no_sender_block',
  })
  // Empty string is as absent as null: an Impressum block of '' is no Impressum.
  assertEquals(decideSend(sendable({ concierge: { followup_sender_block: '' } })), {
    action: 'cancel',
    reason: 'no_sender_block',
  })
})

Deno.test('rule 3: no followup_privacy_url cancels', () => {
  assertEquals(decideSend(sendable({ concierge: { followup_privacy_url: null } })), {
    action: 'cancel',
    reason: 'no_privacy_url',
  })
})

Deno.test('rule 3: no followup_reply_to cancels', () => {
  assertEquals(decideSend(sendable({ concierge: { followup_reply_to: null } })), {
    action: 'cancel',
    reason: 'no_reply_to',
  })
})

// The calendar link is the ENTIRE reason the mail exists. Without it the mail is
// a commercial email with nothing in it, which is the worst of both worlds.
Deno.test('rule 3: an empty calendar_url cancels — the link is the whole payload', () => {
  assertEquals(decideSend(sendable({ concierge: { calendar_url: '' } })), {
    action: 'cancel',
    reason: 'no_calendar_url',
  })
  assertEquals(decideSend(sendable({ concierge: { calendar_url: null } })), {
    action: 'cancel',
    reason: 'no_calendar_url',
  })
})

// Ordering: identity is rule 3, consent is rule 4. A row that has no legal
// sender must not be reported as a consent problem — the coach's dashboard would
// then tell them to chase the visitor when the missing piece is their own.
Deno.test('rule 3: a missing sender identity cancels before the consent is consulted', () => {
  const d = decideSend(sendable({
    concierge: { followup_sender_ack_at: null },
    consentState: 'withdrawn',
    consentEmail: null,
  }))
  assertEquals(d, { action: 'cancel', reason: 'no_sender_ack' })
})

// ---------------------------------------------------------------------------
// RULE 4 — CONSENT
// ---------------------------------------------------------------------------

// A ticked box is 'granted'. It only proves that whoever sat at the keyboard
// typed that address, not that they own it, so it must never send. And it must
// CANCEL rather than defer: waiting does not turn a grant into a confirmation,
// the visitor clicking the link does.
Deno.test('rule 4: granted (ticked but unconfirmed) cancels, it does not wait for a confirmation', () => {
  assertEquals(decideSend(sendable({ consentState: 'granted' })), {
    action: 'cancel',
    reason: 'consent_granted',
  })
})

Deno.test('rule 4: withdrawn cancels and is never reconsidered', () => {
  assertEquals(decideSend(sendable({ consentState: 'withdrawn' })), {
    action: 'cancel',
    reason: 'consent_withdrawn',
  })
})

Deno.test('rule 4: none cancels', () => {
  assertEquals(decideSend(sendable({ consentState: 'none' })), {
    action: 'cancel',
    reason: 'consent_none',
  })
})

// The positive half of the same rule: 'confirmed' is the ONLY state that opens
// the gate. Stated separately so a change to maySendFollowup that widened the
// gate would fail here and not only in consent.test.ts.
Deno.test('rule 4: only confirmed sends', () => {
  const states = ['none', 'granted', 'withdrawn'] as const
  for (const s of states) {
    assertEquals(decideSend(sendable({ consentState: s })).action, 'cancel')
  }
  assertEquals(decideSend(sendable({ consentState: 'confirmed' })).action, 'send')
})

// A conversation's visitor_email is overwritten by any LATER contact submission;
// the consent stamp is not. So a visitor who mistypes their address, gets the
// confirmation nowhere, then corrects it, would — without this check — have the
// corrected row inherit the confirmed consent that belongs to the typo'd
// address. Worse in the other direction: the typo'd address can belong to a real
// stranger who confirmed nothing.
Deno.test('rule 4: a consent for a DIFFERENT address cancels even when it is confirmed', () => {
  const d = decideSend(sendable({
    consentState: 'confirmed',
    consentEmail: 'anna@exmaple.de', // the typo the visitor later corrected
  }))
  assertEquals(d, { action: 'cancel', reason: 'consent_email_mismatch' })
})

Deno.test('rule 4: a confirmed state with no consent email at all cancels as a mismatch', () => {
  assertEquals(decideSend(sendable({ consentEmail: null })), {
    action: 'cancel',
    reason: 'consent_email_mismatch',
  })
  assertEquals(decideSend(sendable({ consentEmail: '' })), {
    action: 'cancel',
    reason: 'consent_email_mismatch',
  })
})

// The comparison is exact, on already-normalised values. Casing differences mean
// one of the two sides was not normalised, which is a bug we want surfaced as a
// refusal rather than papered over here.
Deno.test('rule 4: the address comparison is exact, not case-insensitive', () => {
  assertEquals(decideSend(sendable({ consentEmail: 'Anna@example.de' })), {
    action: 'cancel',
    reason: 'consent_email_mismatch',
  })
})

// ---------------------------------------------------------------------------
// RULE 5 — SUPPRESSED / ALREADY MAILED
// ---------------------------------------------------------------------------

Deno.test('rule 5: a suppressed address cancels', () => {
  assertEquals(decideSend(sendable({ suppressed: true })), {
    action: 'cancel',
    reason: 'suppressed',
  })
})

Deno.test('rule 5: an already mailed row cancels', () => {
  assertEquals(decideSend(sendable({ alreadyMailed: true })), {
    action: 'cancel',
    reason: 'already_mailed',
  })
})

// Both permanent, so the order between them is cosmetic — but pinned, so the
// reason written to the row stays stable for anyone reading the logs.
Deno.test('rule 5: suppression is reported ahead of already_mailed', () => {
  assertEquals(decideSend(sendable({ suppressed: true, alreadyMailed: true })), {
    action: 'cancel',
    reason: 'suppressed',
  })
})

// Consent is rule 4, suppression rule 5. A withdrawn consent is the stronger and
// more legally relevant statement, so it must be the one recorded.
Deno.test('rule 5: a withdrawn consent is reported ahead of suppression', () => {
  assertEquals(decideSend(sendable({ consentState: 'withdrawn', suppressed: true })), {
    action: 'cancel',
    reason: 'consent_withdrawn',
  })
})

// ---------------------------------------------------------------------------
// RULE 6 — THE COACH'S CURRENT STATE: DEFER, NEVER CANCEL
//
// These three are the queue's insurance policy. A coach pausing for a day, a
// switch flipped by accident, a card that fails on a Friday: all normal, all
// temporary, none of them a reason to destroy queued mail that the visitor
// explicitly asked for.
// ---------------------------------------------------------------------------

Deno.test('rule 6: is_active false DEFERS, it does not cancel', () => {
  const d = decideSend(sendable({ concierge: { is_active: false } }))
  const deferred = assertDefer(d, 'sender_paused', NOW)
  assertEquals(deferred.until, new Date(NOW.getTime() + SENDER_DEFER_MS).toISOString())
})

Deno.test('rule 6: followup_enabled false DEFERS, it does not cancel', () => {
  const d = decideSend(sendable({ concierge: { followup_enabled: false } }))
  assertDefer(d, 'sender_paused', NOW)
})

// `followup_enabled !== true` — so an unset column is off, not on. A follow-up
// mail is opt-in; a NULL must never be read as consent to start mailing.
Deno.test('rule 6: followup_enabled null or absent DEFERS — the switch is opt-in', () => {
  assertDefer(decideSend(sendable({ concierge: { followup_enabled: null } })), 'sender_paused', NOW)
  assertDefer(
    decideSend(sendable({ concierge: { followup_enabled: undefined } })),
    'sender_paused',
    NOW,
  )
})

// entitled_until is a LAPSING CACHE that self-heals on the next subscription
// webhook. Cancelling on it would wipe a queue over a payment that lands an hour
// later; deferring costs a delay and nothing else.
Deno.test('rule 6: a lapsed entitled_until DEFERS, it does not cancel', () => {
  const d = decideSend(sendable({ concierge: { entitled_until: '2026-08-06T09:59:00.000Z' } }))
  assertDefer(d, 'sender_paused', NOW)
})

Deno.test('rule 6: a null or unparseable entitled_until DEFERS', () => {
  assertDefer(decideSend(sendable({ concierge: { entitled_until: null } })), 'sender_paused', NOW)
  assertDefer(decideSend(sendable({ concierge: { entitled_until: '' } })), 'sender_paused', NOW)
  assertDefer(
    decideSend(sendable({ concierge: { entitled_until: 'not-a-timestamp' } })),
    'sender_paused',
    NOW,
  )
})

// The lapse boundary: entitled_until is compared with strict >, so an
// entitlement expiring exactly now is already lapsed.
Deno.test('rule 6: entitled_until exactly equal to now is already lapsed', () => {
  assertDefer(
    decideSend(sendable({ concierge: { entitled_until: NOW.toISOString() } })),
    'sender_paused',
    NOW,
  )
})

// A deferral that lands after the row's own expiry is not a deferral. Scheduling
// it would wake the row once more only to cancel it then; say so now, and say
// WHY in the reason, so the log still records that the sender was paused.
Deno.test('rule 6: a deferral that would land past expires_at cancels NOW', () => {
  const d = decideSend(sendable({
    concierge: { is_active: false },
    // Expires in one hour; the sender defer is six.
    row: { expires_at: '2026-08-06T11:00:00.000Z' },
  }))
  assertEquals(d, { action: 'cancel', reason: 'deferred_past_expiry_sender_paused' })
})

// Landing EXACTLY on the expiry is a cancel too (>=): a wake-up at the moment
// the row dies buys nothing.
Deno.test('rule 6: a deferral landing exactly on expires_at cancels', () => {
  const d = decideSend(sendable({
    concierge: { is_active: false },
    row: { expires_at: new Date(NOW.getTime() + SENDER_DEFER_MS).toISOString() },
  }))
  assertEquals(d, { action: 'cancel', reason: 'deferred_past_expiry_sender_paused' })
  // One millisecond later it is a deferral again.
  const ok = decideSend(sendable({
    concierge: { is_active: false },
    row: { expires_at: new Date(NOW.getTime() + SENDER_DEFER_MS + 1).toISOString() },
  }))
  assertDefer(ok, 'sender_paused', NOW)
})

// Ordering: the coach's state is rule 6, the clock is rule 7. A paused sender at
// 03:00 must be recorded as paused — deferring for 'quiet_hours' would send the
// row back to sleep with a reason that resolves on its own and hide a state that
// does not.
Deno.test('rule 6: a paused sender in quiet hours is reported as paused, not as quiet hours', () => {
  const d = decideSend(sendable({ concierge: { is_active: false }, localHour: 3 }))
  const deferred = assertDefer(d, 'sender_paused', NOW)
  assertEquals(deferred.until, new Date(NOW.getTime() + SENDER_DEFER_MS).toISOString())
})

// ---------------------------------------------------------------------------
// RULE 7 — QUIET HOURS, LAST OF ALL
// ---------------------------------------------------------------------------

// The reason quiet hours sit last: they are the ONLY condition that resolves
// purely by waiting. Evaluated earlier they would mask a withdrawn consent
// behind a defer, and the row would come back at 08:00 to cancel for a reason
// that was already true at 22:00 — with a night of "pending" in the coach's
// dashboard in between.
Deno.test('rule 7: quiet hours never mask a withdrawn consent', () => {
  const d = decideSend(sendable({ consentState: 'withdrawn', localHour: 23 }))
  assertEquals(d, { action: 'cancel', reason: 'consent_withdrawn' })
})

Deno.test('rule 7: quiet hours never mask a suppression or an expiry', () => {
  assertEquals(decideSend(sendable({ suppressed: true, localHour: 2 })), {
    action: 'cancel',
    reason: 'suppressed',
  })
  assertEquals(
    decideSend(sendable({ row: { expires_at: '2026-08-06T09:00:00.000Z' }, localHour: 2 })),
    { action: 'cancel', reason: 'expired' },
  )
})

// The boundaries, exactly. 20:00 is still the evening and still business-like;
// 21:00 is the first hour that waits.
Deno.test('rule 7 boundary: hour 20 sends, hour 21 defers', () => {
  const at20 = new Date('2026-08-06T20:00:00.000Z')
  assertEquals(decideSend(sendable({ now: at20, localHour: 20 })), { action: 'send' })

  const at21 = new Date('2026-08-06T21:00:00.000Z')
  assertDefer(decideSend(sendable({ now: at21, localHour: 21 })), 'quiet_hours', at21)
  assertEquals(QUIET_START_HOUR, 21)
})

// The morning boundary. 07:00 still waits; 08:00 is the first hour that sends.
Deno.test('rule 7 boundary: hour 7 defers, hour 8 sends', () => {
  const at7 = new Date('2026-08-07T07:00:00.000Z')
  assertDefer(decideSend(sendable({ now: at7, localHour: 7 })), 'quiet_hours', at7)

  const at8 = new Date('2026-08-07T08:00:00.000Z')
  assertEquals(decideSend(sendable({ now: at8, localHour: 8 })), { action: 'send' })
  assertEquals(QUIET_END_HOUR, 8)
})

// The arithmetic, not just the branch: 24 - 22 + 8 = 10 hours. Not "six hours
// later" (that would be 04:00, still the middle of the night) and not
// "immediately". A mail that lands at 03:40 reads as a machine, and the whole
// product promise is that it does not.
Deno.test('rule 7 arithmetic: a 22:00 deferral lands the NEXT morning at 08:00', () => {
  const at22 = new Date('2026-08-06T22:00:00.000Z')
  const d = assertDefer(
    decideSend(sendable({ now: at22, localHour: 22 })),
    'quiet_hours',
    at22,
  )
  assertEquals(d.until, '2026-08-07T08:00:00.000Z')
})

// The other side of midnight: 8 - 3 = 5 hours, landing the SAME morning. The
// naive "always add until tomorrow" version would lose a whole day here.
Deno.test('rule 7 arithmetic: a 03:00 deferral lands at 08:00 the SAME morning', () => {
  const at3 = new Date('2026-08-07T03:00:00.000Z')
  const d = assertDefer(decideSend(sendable({ now: at3, localHour: 3 })), 'quiet_hours', at3)
  assertEquals(d.until, '2026-08-07T08:00:00.000Z')
})

// Midnight itself: 8 - 0 = 8 hours.
Deno.test('rule 7 arithmetic: a 00:00 deferral lands at 08:00 the same morning', () => {
  const at0 = new Date('2026-08-07T00:00:00.000Z')
  const d = assertDefer(decideSend(sendable({ now: at0, localHour: 0 })), 'quiet_hours', at0)
  assertEquals(d.until, '2026-08-07T08:00:00.000Z')
})

// And the last hour of the day: 24 - 23 + 8 = 9 hours.
Deno.test('rule 7 arithmetic: a 23:00 deferral lands the next morning at 08:00', () => {
  const at23 = new Date('2026-08-06T23:00:00.000Z')
  const d = assertDefer(decideSend(sendable({ now: at23, localHour: 23 })), 'quiet_hours', at23)
  assertEquals(d.until, '2026-08-07T08:00:00.000Z')
})

// Quiet hours run through the same deferOrExpire, so they too cancel rather than
// schedule a wake-up for a row that will be dead by morning — and the reason
// still says which clock it was.
Deno.test('rule 7: a quiet-hours deferral past expires_at cancels with its own reason', () => {
  const at22 = new Date('2026-08-06T22:00:00.000Z')
  const d = decideSend(sendable({
    now: at22,
    localHour: 22,
    // Dies at 02:00, six hours before the mail would go out.
    row: { expires_at: '2026-08-07T02:00:00.000Z' },
  }))
  assertEquals(d, { action: 'cancel', reason: 'deferred_past_expiry_quiet_hours' })
})

// ---------------------------------------------------------------------------
// NOT DUE
// ---------------------------------------------------------------------------

// The defer that costs nothing: wake up exactly when the row was scheduled for,
// not six hours later and not at the next morning.
Deno.test('not_due: a row scheduled in the future defers until its own scheduled_at', () => {
  const d = decideSend(sendable({ row: { scheduled_at: '2026-08-06T14:00:00.000Z' } }))
  const deferred = assertDefer(d, 'not_due', NOW)
  assertEquals(deferred.until, '2026-08-06T14:00:00.000Z')
})

Deno.test('not_due: scheduled_at exactly equal to now is due', () => {
  assertEquals(decideSend(sendable({ row: { scheduled_at: NOW.toISOString() } })), {
    action: 'send',
  })
})

// FIXED 2026-08-08 (was: quiet hours won, and deferred the row to 08:00 TODAY —
// a wake-up answering a question about a moment three days away, which then just
// re-deferred, and which recorded 'quiet_hours' as the reason a row was waiting
// when the real reason was that it was not due). not_due now wins, and the row
// is deferred to its own scheduled_at.
Deno.test('not_due beats quiet hours: a row that is not due waits for ITS OWN time', () => {
  const at3 = new Date('2026-08-07T03:00:00.000Z')
  const d = assertDefer(
    decideSend(sendable({ now: at3, localHour: 3, row: { scheduled_at: '2026-08-09T12:00:00.000Z' } })),
    'not_due',
    at3,
  )
  assertEquals(d.until, '2026-08-09T12:00:00.000Z')
})

// ---------------------------------------------------------------------------
// CURRENT BEHAVIOUR THAT IS WORTH KNOWING ABOUT
//
// These pin what decideSend does TODAY at three seams where a reader might
// reasonably expect something else. They are not endorsements: if one of them
// fails because the rule changed, read the comment and decide, do not just
// update the expectation.
// ---------------------------------------------------------------------------

// MAX_ATTEMPTS is exported and OutboxRow carries `attempts`, but decideSend never
// consults either. A row that has failed to send far more often than the
// constant allows is still answered 'send'. Whatever enforces the cap lives
// outside this pure function.
Deno.test('attempts is not consulted: a row far past MAX_ATTEMPTS still sends', () => {
  assertEquals(MAX_ATTEMPTS, 3)
  assertEquals(decideSend(sendable({ row: { attempts: MAX_ATTEMPTS + 10 } })), { action: 'send' })
})

// followup_reply_to_verified_at exists on SenderRow but no rule reads it: an
// unverified reply-to address is enough to send. Rule 3 checks only that a
// reply-to is PRESENT.
// FIXED 2026-08-08 (was: presence alone was enough). Rule 3 cites §5 DDG's
// "real, reachable sender" and a coach typing an address establishes neither.
// Note the live consequence, which is deliberate: nothing sets this column yet,
// so this rule currently cancels EVERY row — visibly, with a reason in the
// queue — rather than mailing to an address nobody confirmed.
Deno.test('an UNVERIFIED followup_reply_to cancels: present is not the same as reachable', () => {
  assertEquals(decideSend(sendable({ concierge: { followup_reply_to_verified_at: null } })), {
    action: 'cancel',
    reason: 'reply_to_unverified',
  })
})

// FIXED 2026-08-08. NaN loses every comparison, so a garbage expiry used to slip
// past rule 1 AND past the deferred-past-expiry guard: the row could send
// forever, or be re-deferred every six hours forever, with no path to cancel.
// For a rule about commercial mail in a named person's name the only defensible
// direction is closed.
Deno.test('a malformed expires_at CANCELS rather than making the row immortal', () => {
  assertEquals(decideSend(sendable({ row: { expires_at: 'not-a-timestamp' } })), {
    action: 'cancel',
    reason: 'unparseable_expiry',
  })
  // And it wins over a reason that would otherwise defer, so there is no route
  // back into the six-hour loop.
  assertEquals(
    decideSend(sendable({ row: { expires_at: 'not-a-timestamp' }, concierge: { is_active: false } })),
    { action: 'cancel', reason: 'unparseable_expiry' },
  )
})

// FIXED 2026-08-08, same posture as the expiry: a timestamp we cannot read is
// not a licence to send now.
Deno.test('a malformed scheduled_at CANCELS rather than reading as due', () => {
  assertEquals(decideSend(sendable({ row: { scheduled_at: 'whenever' } })), {
    action: 'cancel',
    reason: 'unparseable_schedule',
  })
})
