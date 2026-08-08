import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1'
import {
  buildConsentNotice,
  buildConsentRow,
  CONSENT_NOTICE_VERSION,
  type ConsentSnapshot,
  effectiveConsentState,
  isConsentMismatch,
  maySendFollowup,
  normalizeConsentEmail,
  parseConsentSubmission,
} from './consent.ts'

// ---------------------------------------------------------------------------
// THE WORDING LOCK
//
// These two tests are the mechanism that FORCES a version bump. The expected
// strings below are inlined literals, deliberately not imported and deliberately
// not built from the module's own templates — an assertion that compared the
// module to itself would pass through any edit.
//
// If one of these fails, you changed the wording. That is allowed. What is NOT
// allowed is editing the literal to match: rows already stored under
// 'concierge-followup-email-v1' claim the visitor read THESE words. Add a new
// version, keep the old one buildable, and update src/lib/consent.ts to match.
// ---------------------------------------------------------------------------

Deno.test('wording lock: the German label and notice are exactly v1', () => {
  const built = buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', 'Coach Meyer')
  assertEquals(
    built?.label,
    'Ja, Coach Meyer darf mir zu diesem Gespräch eine E-Mail schreiben, auch wenn ich heute keinen Termin buche.',
  )
  assertEquals(
    built?.notice,
    'Wir schicken dir gleich eine kurze Bestätigungsmail. Erst wenn du darin auf den Link klickst, gilt die Einwilligung. Sie gilt nur für Coach Meyer und nur für E-Mail, es geht ausschließlich um dieses Gespräch, eine einzige E-Mail, kein Newsletter, keine Weitergabe an Dritte. Du kannst jederzeit widerrufen, mit einem Klick am Ende der E-Mail. Der Versand läuft technisch über 2Fronts (2fronts.de) im Auftrag von Coach Meyer. Deine Einwilligung speichern wir mit Zeitpunkt drei Jahre lang, um sie belegen zu können, mehr dazu in der Datenschutzerklärung. Ohne Häkchen kannst du hier ganz normal weiterschreiben und einen Termin buchen.',
  )
})

Deno.test('wording lock: the English label and notice are exactly v1', () => {
  const built = buildConsentNotice(CONSENT_NOTICE_VERSION, 'en', 'Coach Meyer')
  assertEquals(
    built?.label,
    'Yes, Coach Meyer may email me about this conversation, even if I do not book an appointment today.',
  )
  assertEquals(
    built?.notice,
    'We will send you a short confirmation email in a moment. Your consent only counts once you click the link in it. It applies to Coach Meyer only and to email only, it covers this conversation and nothing else, a single email, no newsletter, no sharing with third parties. You can withdraw at any time, with one click at the bottom of that email. The sending runs technically through 2Fronts (2fronts.de) on behalf of Coach Meyer. We store your consent with a timestamp for three years so we can prove it, more on this in the privacy policy. Without the tick you can carry on chatting here and book an appointment as normal.',
  )
})

// The retention number in the notice must match the schema comment and the
// privacy page. Asserted here so a change to one of the three trips a test.
Deno.test('wording lock: both locales state the three-year retention', () => {
  assertNotEquals(buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', 'X')!.notice.indexOf('drei Jahre'), -1)
  assertNotEquals(
    buildConsentNotice(CONSENT_NOTICE_VERSION, 'en', 'X')!.notice.indexOf('three years'),
    -1,
  )
})

// The German notice is visitor-facing prose. The house style forbids em and en
// dashes in German text; a dash here would also be the single clearest "written
// by a machine" tell on the page a coach is showing their leads.
Deno.test('wording lock: the German strings contain no em or en dash', () => {
  const built = buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', 'Coach Meyer')!
  assertEquals(built.notice.includes('—'), false)
  assertEquals(built.notice.includes('–'), false)
  assertEquals(built.label.includes('—'), false)
  assertEquals(built.label.includes('–'), false)
})

// ---------------------------------------------------------------------------
// buildConsentNotice
// ---------------------------------------------------------------------------

Deno.test('buildConsentNotice returns null for an unknown version', () => {
  assertEquals(buildConsentNotice('concierge-followup-email-v2', 'de', 'Coach Meyer'), null)
  assertEquals(buildConsentNotice('', 'de', 'Coach Meyer'), null)
})

Deno.test('buildConsentNotice returns null for a blank or oversized business name', () => {
  assertEquals(buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', '   '), null)
  assertEquals(buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', 'x'.repeat(201)), null)
})

Deno.test('buildConsentNotice trims the business name it renders and reports', () => {
  const built = buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', '  Coach Meyer  ')!
  assertEquals(built.rendered_business_name, 'Coach Meyer')
  assertEquals(built.notice.includes('  Coach Meyer  '), false)
})

// ---------------------------------------------------------------------------
// parseConsentSubmission
// ---------------------------------------------------------------------------

Deno.test('parseConsentSubmission accepts a well-formed claim', () => {
  assertEquals(
    parseConsentSubmission({
      notice_version: CONSENT_NOTICE_VERSION,
      locale: 'de',
      rendered_business_name: 'Coach Meyer',
    }),
    { notice_version: CONSENT_NOTICE_VERSION, locale: 'de', rendered_business_name: 'Coach Meyer' },
  )
})

Deno.test('parseConsentSubmission rejects a submission with no rendered_business_name', () => {
  assertEquals(
    parseConsentSubmission({ notice_version: CONSENT_NOTICE_VERSION, locale: 'de' }),
    null,
  )
  assertEquals(
    parseConsentSubmission({
      notice_version: CONSENT_NOTICE_VERSION,
      locale: 'de',
      rendered_business_name: '   ',
    }),
    null,
  )
})

Deno.test('parseConsentSubmission rejects non-objects, arrays and unknown locales', () => {
  assertEquals(parseConsentSubmission('yes'), null)
  assertEquals(parseConsentSubmission(true), null)
  assertEquals(parseConsentSubmission(null), null)
  assertEquals(parseConsentSubmission([CONSENT_NOTICE_VERSION]), null)
  assertEquals(
    parseConsentSubmission({
      notice_version: CONSENT_NOTICE_VERSION,
      locale: 'fr',
      rendered_business_name: 'Coach Meyer',
    }),
    null,
  )
})

// ---------------------------------------------------------------------------
// normalizeConsentEmail
// ---------------------------------------------------------------------------

Deno.test('normalizeConsentEmail lowercases and trims, and nothing else', () => {
  assertEquals(normalizeConsentEmail(' A@B.DE '), 'a@b.de')
  // Plus-addressing and dots are RFC-significant. Stripping them is a Gmail
  // convention that would bind one person's consent to a different mailbox.
  assertEquals(normalizeConsentEmail('Max+Coach@Gmail.com'), 'max+coach@gmail.com')
  assertEquals(normalizeConsentEmail('m.a.x@gmail.com'), 'm.a.x@gmail.com')
})

// ---------------------------------------------------------------------------
// effectiveConsentState / maySendFollowup
// ---------------------------------------------------------------------------

Deno.test('effectiveConsentState: empty ledger is none', () => {
  assertEquals(effectiveConsentState([]), 'none')
})

Deno.test('effectiveConsentState: latest row wins', () => {
  assertEquals(
    effectiveConsentState([
      { action: 'granted', created_at: '2026-08-01T10:00:00Z' },
      { action: 'confirmed', created_at: '2026-08-01T10:05:00Z' },
    ]),
    'confirmed',
  )
  assertEquals(
    effectiveConsentState([
      { action: 'granted', created_at: '2026-08-01T10:00:00Z' },
      { action: 'confirmed', created_at: '2026-08-01T10:05:00Z' },
      { action: 'withdrawn', created_at: '2026-08-02T09:00:00Z' },
    ]),
    'withdrawn',
  )
})

Deno.test('effectiveConsentState: a re-grant after a withdrawal wins again', () => {
  assertEquals(
    effectiveConsentState([
      { action: 'withdrawn', created_at: '2026-08-02T09:00:00Z' },
      { action: 'granted', created_at: '2026-08-03T09:00:00Z' },
    ]),
    'granted',
  )
})

Deno.test('effectiveConsentState: a tie resolves to withdrawn, never to confirmed', () => {
  assertEquals(
    effectiveConsentState([
      { action: 'confirmed', created_at: '2026-08-01T10:00:00Z' },
      { action: 'withdrawn', created_at: '2026-08-01T10:00:00Z' },
    ]),
    'withdrawn',
  )
})

Deno.test('maySendFollowup: only confirmed opens the gate', () => {
  assertEquals(maySendFollowup('confirmed'), true)
  // The one that matters: a ticked box alone must never send. It proves someone
  // typed the address, not that they own it.
  assertEquals(maySendFollowup('granted'), false)
  assertEquals(maySendFollowup('withdrawn'), false)
  assertEquals(maySendFollowup('none'), false)
})

// ---------------------------------------------------------------------------
// buildConsentRow
// ---------------------------------------------------------------------------

const BASE = {
  concierge_id: 'c-1',
  conversation_id: 'conv-1',
  sender_owner_id: 'owner-1',
  visitor_email: ' Anna@Example.DE ',
  business_name: 'Coach Meyer',
  locale: 'de' as const,
  prior_state: 'none' as const,
  prior_snapshot: null,
  visitor_ip: '203.0.113.9',
  visitor_user_agent: 'Mozilla/5.0',
}

const TICKED = {
  notice_version: CONSENT_NOTICE_VERSION,
  locale: 'de' as const,
  rendered_business_name: 'Coach Meyer',
}

Deno.test('buildConsentRow: a valid grant carries the server-rebuilt wording snapshot', () => {
  const { row, reason } = buildConsentRow({ ...BASE, submission: TICKED })
  assertEquals(reason, 'ok')
  assertEquals(row!.action, 'granted')
  assertEquals(row!.source, 'contact_form')
  assertEquals(row!.channel, 'email')
  assertEquals(row!.notice_version, CONSENT_NOTICE_VERSION)
  assertEquals(row!.rendered_business_name, 'Coach Meyer')
  assertEquals(row!.visitor_email_norm, 'anna@example.de')
  assertEquals(row!.visitor_email, 'Anna@Example.DE')
  assertEquals(row!.sender_owner_id, 'owner-1')
  // The stored text is the SERVER's rendering, not the client's claim.
  assertEquals(
    row!.notice_text,
    buildConsentNotice(CONSENT_NOTICE_VERSION, 'de', 'Coach Meyer')!.notice,
  )
})

Deno.test('buildConsentRow: the row carries no created_at key at all', () => {
  const { row } = buildConsentRow({ ...BASE, submission: TICKED })
  // Not "created_at is undefined" — the KEY must be absent, so the column
  // default fires. An isolate-supplied timestamp is a clock we do not control
  // turning up in evidence.
  assertEquals(Object.prototype.hasOwnProperty.call(row!, 'created_at'), false)
})

Deno.test('buildConsentRow: version mismatch yields no row and is flagged as a mismatch', () => {
  const { row, reason } = buildConsentRow({
    ...BASE,
    submission: { ...TICKED, notice_version: 'concierge-followup-email-v0' },
  })
  assertEquals(row, null)
  assertEquals(reason, 'version_mismatch')
  assertEquals(isConsentMismatch(reason), true)
})

Deno.test('buildConsentRow: locale mismatch yields no row and is flagged', () => {
  const { row, reason } = buildConsentRow({
    ...BASE,
    submission: { ...TICKED, locale: 'en' },
  })
  assertEquals(row, null)
  assertEquals(reason, 'locale_mismatch')
  assertEquals(isConsentMismatch(reason), true)
})

Deno.test('buildConsentRow: business-name mismatch yields no row and is flagged', () => {
  // The visitor read "Coach Schmidt" on screen; the server would bind the
  // consent to "Coach Meyer". Refuse.
  const { row, reason } = buildConsentRow({
    ...BASE,
    submission: { ...TICKED, rendered_business_name: 'Coach Schmidt' },
  })
  assertEquals(row, null)
  assertEquals(reason, 'business_name_mismatch')
  assertEquals(isConsentMismatch(reason), true)
})

Deno.test('buildConsentRow: ticking again over a live grant writes nothing, silently', () => {
  for (const prior of ['granted', 'confirmed'] as const) {
    const { row, reason } = buildConsentRow({ ...BASE, prior_state: prior, submission: TICKED })
    assertEquals(row, null)
    assertEquals(reason, 'already_granted')
    // Normal traffic, not an incident: must not page anyone.
    assertEquals(isConsentMismatch(reason), false)
  }
})

Deno.test('buildConsentRow: unticked with no prior grant writes nothing, silently', () => {
  const { row, reason } = buildConsentRow({ ...BASE, submission: null })
  assertEquals(row, null)
  assertEquals(reason, 'no_consent_no_prior')
  assertEquals(isConsentMismatch(reason), false)
})

Deno.test('buildConsentRow: unticked over a prior grant is a withdrawal in the ORIGINAL wording', () => {
  const snapshot: ConsentSnapshot = {
    notice_version: 'concierge-followup-email-v0',
    notice_label: 'ALTES LABEL',
    notice_text: 'ALTER HINWEISTEXT',
    rendered_business_name: 'Coach Meyer (alt)',
    locale: 'de',
  }
  const { row, reason } = buildConsentRow({
    ...BASE,
    prior_state: 'granted',
    prior_snapshot: snapshot,
    // Same conversation that gave it — the only case allowed to take it back
    // from the form. See prior_conversation_id in consent.ts.
    prior_conversation_id: 'conv-1',
    submission: null,
  })
  assertEquals(reason, 'ok')
  assertEquals(row!.action, 'withdrawn')
  assertEquals(row!.source, 'contact_form_unticked')
  // A withdrawal quoting today's text would describe a screen this visitor
  // never saw.
  assertEquals(row!.notice_version, 'concierge-followup-email-v0')
  assertEquals(row!.notice_text, 'ALTER HINWEISTEXT')
  assertEquals(row!.rendered_business_name, 'Coach Meyer (alt)')
})

Deno.test('buildConsentRow: unticked over a CONFIRMED consent also withdraws', () => {
  const { row, reason } = buildConsentRow({
    ...BASE,
    prior_state: 'confirmed',
    prior_snapshot: null,
    prior_conversation_id: 'conv-1',
    submission: null,
  })
  assertEquals(reason, 'ok')
  assertEquals(row!.action, 'withdrawn')
})

// The endpoint is unauthenticated and accepts any well-formed address, so an
// unticked resubmit from SOMEWHERE ELSE must not revoke a consent. Two harms
// otherwise: a stranger who guesses a lead's address files a permanent
// withdrawal in their name and the coach silently loses a lead they paid for;
// and a real visitor returning in a new session revokes their own confirmed
// consent just by resubmitting their details, because the box always
// re-renders unticked.
Deno.test('buildConsentRow: an unticked resubmit from ANOTHER conversation does not withdraw', () => {
  const { row, reason } = buildConsentRow({
    ...BASE,
    conversation_id: 'conv-2',
    prior_state: 'confirmed',
    prior_snapshot: null,
    prior_conversation_id: 'conv-1',
    submission: null,
  })
  assertEquals(row, null)
  assertEquals(reason, 'withdrawal_not_owned')
  // Routine, not an incident: must not page anyone.
  assertEquals(isConsentMismatch(reason), false)
})

Deno.test('buildConsentRow: an unticked resubmit with no known grant conversation does not withdraw', () => {
  // A grant filed before this column carried a conversation. Fail closed:
  // keeping a consent we cannot prove ownership of is recoverable via the
  // unsubscribe link; destroying one is not.
  const { row, reason } = buildConsentRow({
    ...BASE,
    prior_state: 'granted',
    prior_snapshot: null,
    prior_conversation_id: null,
    submission: null,
  })
  assertEquals(row, null)
  assertEquals(reason, 'withdrawal_not_owned')
})

Deno.test('buildConsentRow: unticked over an ALREADY withdrawn consent writes nothing', () => {
  const { row, reason } = buildConsentRow({
    ...BASE,
    prior_state: 'withdrawn',
    submission: null,
  })
  assertEquals(row, null)
  assertEquals(reason, 'no_consent_no_prior')
})

Deno.test('buildConsentRow: ip and user agent are truncated, blanks become null', () => {
  const { row } = buildConsentRow({
    ...BASE,
    submission: TICKED,
    visitor_ip: 'x'.repeat(80),
    visitor_user_agent: 'u'.repeat(900),
  })
  assertEquals(row!.visitor_ip!.length, 45)
  assertEquals(row!.visitor_user_agent!.length, 512)

  const blank = buildConsentRow({
    ...BASE,
    submission: TICKED,
    visitor_ip: '   ',
    visitor_user_agent: undefined,
  })
  assertEquals(blank.row!.visitor_ip, null)
  assertEquals(blank.row!.visitor_user_agent, null)
})

Deno.test('buildConsentRow: an English concierge grants under the English wording', () => {
  const { row, reason } = buildConsentRow({
    ...BASE,
    locale: 'en',
    submission: { ...TICKED, locale: 'en' },
  })
  assertEquals(reason, 'ok')
  assertEquals(row!.locale, 'en')
  assertEquals(row!.notice_text.startsWith('We will send you a short confirmation email'), true)
})
