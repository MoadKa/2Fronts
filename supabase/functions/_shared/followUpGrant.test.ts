import { assertEquals } from 'jsr:@std/assert@1'
import {
  CONSENT_FUTURE_SKEW_MS,
  CONSENT_MAX_AGE_MS,
  FOLLOW_UP_SENDER_SHIPPED,
  type FollowUpGrant,
  type FollowUpGrantInput,
  isFollowUpGrant,
  resolveFollowUpGrant,
  resolveFollowUpGrantResult,
} from './followUpGrant.ts'

const NOW = new Date('2026-08-13T12:00:00.000Z')

// Every precondition satisfied. Each test below takes this away exactly ONE
// thing, so a test that passes proves the rule it names and nothing else.
function greenInput(over: Partial<FollowUpGrantInput> = {}): FollowUpGrantInput {
  return {
    concierge: {
      is_active: true,
      is_demo: false,
      demo_expires_at: null,
      entitled_until: '2026-12-01T00:00:00.000Z',
      calendar_url: 'https://cal.com/acme/intro',
      followup_enabled: true,
      followup_sender_ack_at: '2026-08-01T09:00:00.000Z',
      followup_sender_block: 'Acme Coaching GmbH, Musterstr. 1, 45127 Essen',
      followup_privacy_url: 'https://acme.example/datenschutz',
      followup_reply_to: 'coach@acme.example',
      followup_reply_to_verified_at: '2026-08-02T09:00:00.000Z',
    },
    consentState: 'confirmed',
    consentEmail: 'visitor@example.com',
    consentConfirmedAt: '2026-08-13T10:00:00.000Z',
    visitorEmail: 'visitor@example.com',
    suppressed: false,
    alreadyMailed: false,
    sendingEnabled: true,
    now: NOW,
    ...over,
  }
}

// Shorthand: run the all-green input with ONE field changed, with the shipped
// flag forced on, and report the denial reason.
function reasonWith(over: Partial<FollowUpGrantInput>): string {
  return resolveFollowUpGrantResult(greenInput(over), true).reason
}

// --- The honesty switch ------------------------------------------------------

Deno.test('FOLLOW_UP_SENDER_SHIPPED is false, and it alone withholds a fully green grant', () => {
  // The device that keeps the bot honest until a real mail has been sent AND
  // received. If this assertion ever fails, the reviewer must be able to point
  // at the inbox that received one.
  assertEquals(FOLLOW_UP_SENDER_SHIPPED, false)
  // Same input that produces a grant two tests down. The DEFAULT call refuses it.
  assertEquals(resolveFollowUpGrant(greenInput()), null)
  assertEquals(resolveFollowUpGrantResult(greenInput()).reason, 'sender_not_shipped')
})

// --- The one green path ------------------------------------------------------

Deno.test('a fully green input issues a branded grant naming the recipient and the consent', () => {
  const grant = resolveFollowUpGrant(greenInput(), true)
  assertEquals(grant !== null, true)
  assertEquals(isFollowUpGrant(grant), true)
  assertEquals(grant!.recipientEmail, 'visitor@example.com')
  assertEquals(grant!.consentConfirmedAt, '2026-08-13T10:00:00.000Z')
})

Deno.test('the address comparison is normalised (case + whitespace), not literal', () => {
  // normalizeConsentEmail lowercases and trims and does nothing else -- no
  // dot-stripping, no plus-stripping. A+B@Example.com and a+b@example.com are the
  // same mailbox; a+b@x.de and ab@x.de are NOT, and must stay different here.
  const grant = resolveFollowUpGrant(
    greenInput({ consentEmail: '  Visitor@Example.com ', visitorEmail: 'visitor@example.com' }),
    true,
  )
  assertEquals(grant?.recipientEmail, 'visitor@example.com')
  assertEquals(reasonWith({ consentEmail: 'v+a@example.com', visitorEmail: 'v@example.com' }), 'consent_email_mismatch')
})

// --- No single precondition is sufficient ------------------------------------

Deno.test('the coach switch ALONE does not unlock it', () => {
  // followup_enabled is the coach saying "I want this on". It is not a
  // permission and it is not evidence, and the column comment in
  // 20260809100000 says so in as many words. With nothing else in place the
  // grant is refused at the first missing piece of sender identity.
  const bare: FollowUpGrantInput = {
    concierge: {
      is_active: true,
      is_demo: false,
      entitled_until: '2026-12-01T00:00:00.000Z',
      followup_enabled: true,
    },
    consentState: 'none',
    consentEmail: null,
    consentConfirmedAt: null,
    visitorEmail: 'visitor@example.com',
    suppressed: false,
    alreadyMailed: false,
    sendingEnabled: true,
    now: NOW,
  }
  assertEquals(resolveFollowUpGrant(bare, true), null)
  assertEquals(resolveFollowUpGrantResult(bare, true).reason, 'no_sender_ack')
})

Deno.test('a confirmed consent ALONE does not unlock it', () => {
  // The mirror of the test above: perfect consent, no sender. §7 Abs. 2 UWG
  // permission and §5 DDG identity are two separate requirements and neither
  // substitutes for the other.
  const bare: FollowUpGrantInput = {
    concierge: { is_active: true, is_demo: false, entitled_until: '2026-12-01T00:00:00.000Z' },
    consentState: 'confirmed',
    consentEmail: 'visitor@example.com',
    consentConfirmedAt: '2026-08-13T10:00:00.000Z',
    visitorEmail: 'visitor@example.com',
    suppressed: false,
    alreadyMailed: false,
    sendingEnabled: true,
    now: NOW,
  }
  assertEquals(resolveFollowUpGrant(bare, true), null)
  // The coach's own switch is off, so it never even reaches the consent.
  assertEquals(resolveFollowUpGrantResult(bare, true).reason, 'followup_switched_off')
})

// --- Consent ------------------------------------------------------------------

Deno.test('a consent for a DIFFERENT address does not unlock it', () => {
  // concierge_conversations.visitor_email is overwritten by any later contact
  // submission while the consent stamp is not. Without this check, a visitor
  // correcting a typo re-points their old consent at a stranger's mailbox and
  // the bot promises that stranger a mail. decide.ts rule 4 refuses the same
  // case at send time; refusing it here is what stops the promise being made.
  assertEquals(reasonWith({ visitorEmail: 'someone.else@example.com' }), 'consent_email_mismatch')
  assertEquals(reasonWith({ consentEmail: null }), 'consent_email_mismatch')
  assertEquals(reasonWith({ visitorEmail: null }), 'no_visitor_email')
})

Deno.test('only a CONFIRMED consent unlocks it; granted, none and withdrawn do not', () => {
  assertEquals(reasonWith({ consentState: 'granted' }), 'consent_granted')
  assertEquals(reasonWith({ consentState: 'none' }), 'consent_none')
  assertEquals(reasonWith({ consentState: 'withdrawn' }), 'consent_withdrawn')
})

Deno.test('a 7-month-old consent does not unlock it', () => {
  const sevenMonthsAgo = new Date(NOW.getTime() - 213 * 24 * 60 * 60 * 1000).toISOString()
  assertEquals(reasonWith({ consentConfirmedAt: sevenMonthsAgo }), 'consent_stale')
  // Just inside six months still does.
  const justInside = new Date(NOW.getTime() - (CONSENT_MAX_AGE_MS - 60_000)).toISOString()
  assertEquals(reasonWith({ consentConfirmedAt: justInside }), 'ok')
})

Deno.test('a consent dated in the future is refused beyond a minute of clock skew', () => {
  // The stamp comes from the database clock, `now` from the isolate's. A small
  // disagreement is normal; a large one is a stamp we cannot treat as evidence
  // of something that already happened.
  const wayAhead = new Date(NOW.getTime() + 10 * 60 * 1000).toISOString()
  assertEquals(reasonWith({ consentConfirmedAt: wayAhead }), 'consent_in_future')
  const withinSkew = new Date(NOW.getTime() + CONSENT_FUTURE_SKEW_MS - 1_000).toISOString()
  assertEquals(reasonWith({ consentConfirmedAt: withinSkew }), 'ok')
  // A future stamp must not slip through the AGE check either: a negative age is
  // never "too old", which is why the future test runs first.
  const nextYear = new Date(NOW.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString()
  assertEquals(reasonWith({ consentConfirmedAt: nextYear }), 'consent_in_future')
})

Deno.test('an unreadable or missing consent timestamp does not unlock it', () => {
  assertEquals(reasonWith({ consentConfirmedAt: 'not a date' }), 'consent_unparseable')
  assertEquals(reasonWith({ consentConfirmedAt: null }), 'consent_unparseable')
})

// --- Sender identity ----------------------------------------------------------

Deno.test('an UNVERIFIED reply-to does not unlock it', () => {
  // Nothing writes followup_reply_to_verified_at today, so this is the rule that
  // would still stop the bot if FOLLOW_UP_SENDER_SHIPPED were flipped early. A
  // typo in that address means the coach never sees one reply to a mail carrying
  // their own name -- decide.ts calls the same case reply_to_unverified.
  assertEquals(reasonWith({
    concierge: { ...greenInput().concierge!, followup_reply_to_verified_at: null },
  }), 'reply_to_unverified')
  assertEquals(reasonWith({
    concierge: { ...greenInput().concierge!, followup_reply_to_verified_at: '  ' },
  }), 'reply_to_unverified')
})

Deno.test('every missing piece of sender identity refuses, each with its own reason', () => {
  const base = greenInput().concierge!
  assertEquals(reasonWith({ concierge: { ...base, followup_sender_ack_at: null } }), 'no_sender_ack')
  assertEquals(reasonWith({ concierge: { ...base, followup_sender_block: null } }), 'no_sender_block')
  assertEquals(reasonWith({ concierge: { ...base, followup_privacy_url: null } }), 'no_privacy_url')
  assertEquals(reasonWith({ concierge: { ...base, followup_reply_to: null } }), 'no_reply_to')
  // The booking link is the entire payload of the mail; without one there is no
  // message to promise.
  assertEquals(reasonWith({ concierge: { ...base, calendar_url: '' } }), 'no_calendar_url')
})

// --- The sender's own state ---------------------------------------------------

Deno.test('a demo never gets a grant, however green everything else is', () => {
  // A demo speaks in a named real business's name without their agreement. It
  // may chat. It may not mail, and it may not say it will. decide.ts checks this
  // BEFORE entitlement for the same reason: an in-date demo is "entitled".
  const base = greenInput().concierge!
  assertEquals(reasonWith({
    concierge: { ...base, is_demo: true, demo_expires_at: '2026-12-01T00:00:00.000Z' },
  }), 'is_demo')
})

Deno.test('a switched-off, dormant or unentitled sender gets no grant', () => {
  const base = greenInput().concierge!
  assertEquals(reasonWith({ concierge: { ...base, followup_enabled: false } }), 'followup_switched_off')
  assertEquals(reasonWith({ concierge: { ...base, followup_enabled: null } }), 'followup_switched_off')
  assertEquals(reasonWith({ concierge: { ...base, is_active: false } }), 'sender_inactive')
  assertEquals(reasonWith({ concierge: { ...base, entitled_until: null } }), 'not_entitled')
  assertEquals(reasonWith({ concierge: { ...base, entitled_until: '2026-01-01T00:00:00.000Z' } }), 'not_entitled')
  assertEquals(reasonWith({ concierge: null }), 'concierge_missing')
})

// --- Operational facts --------------------------------------------------------

Deno.test('suppression, a mail already sent, and the global stop switch each refuse', () => {
  // All three are cases where the dispatcher sends nothing, so a promise would
  // be a lie. alreadyMailed is the "eine einzige E-Mail" promise from the consent
  // notice, enforced by the partial unique index in 20260812100000 section 4.
  assertEquals(reasonWith({ suppressed: true }), 'suppressed')
  assertEquals(reasonWith({ alreadyMailed: true }), 'already_mailed')
  assertEquals(reasonWith({ sendingEnabled: false }), 'sending_disabled')
})

// --- The brand ----------------------------------------------------------------

Deno.test('an object literal cannot be a grant', () => {
  // COMPILE TIME is the real assertion here, and it cannot be written as a test
  // because a test that does not compile does not run. Uncommenting either line
  // below must fail `deno check`, because FollowUpGrant's brand key is a
  // module-private `unique symbol` that no other file can name:
  //
  //   const forged: FollowUpGrant = { recipientEmail: 'a@b.de', consentConfirmedAt: 'x' }
  //   const forged: FollowUpGrant = { kind: 'follow_up_grant' }
  //
  // This is why the type is branded rather than carrying a `kind` discriminant:
  // a discriminant is four characters anybody can type, and the whole value of
  // this type is that HOLDING ONE IS PROOF.
  //
  // RUNTIME is what the assertions below cover -- a forgery smuggled in through
  // `as`, through JSON.parse, or through an `any`-typed boundary.
  const forged = { kind: 'follow_up_grant', recipientEmail: 'a@b.de' } as unknown as FollowUpGrant
  assertEquals(isFollowUpGrant(forged), false)
  assertEquals(isFollowUpGrant({}), false)
  assertEquals(isFollowUpGrant(null), false)
  assertEquals(isFollowUpGrant(undefined), false)
  assertEquals(isFollowUpGrant('follow_up_grant'), false)
  // Not even a copy of a real grant's own enumerable properties passes: the
  // brand is a symbol key, and spread copies symbol keys -- so this one DOES.
  // Stated explicitly so nobody mistakes the brand for tamper-proofing at
  // runtime. It is a TYPE-level proof plus a cheap runtime sanity check; the
  // guarantee is that no code can accidentally or casually mint one, not that a
  // determined caller in this same process cannot.
  const real = resolveFollowUpGrant(greenInput(), true)!
  assertEquals(isFollowUpGrant({ ...real }), true)
})
