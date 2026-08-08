import { assertEquals } from 'jsr:@std/assert@1'
import { isEntitledToServe, isExpiredDemo, mayReceiveFollowUp } from './entitlement.ts'

// ---- Entitlement (migration 20260729100000) --------------------------------
// is_active was never a paywall: it only recorded what the last Stripe webhook
// said, so a webhook that never arrived — or a row created without a purchase at
// all — served forever on the operator's model spend. entitled_until expires by
// itself, which is the whole point.
//
// These cases moved here verbatim from concierge-chat/index.test.ts when the
// predicates were extracted; the handler tests that exercise them end-to-end
// (404 on an unpaid row, expiry biting before the model call) stayed there.

Deno.test('isExpiredDemo treats null, empty and unparseable expiries as "never expires"', () => {
  // A garbled timestamp must not silently take a live demo offline: failing
  // open is recoverable, failing closed looks like the product is broken.
  const now = new Date('2026-07-27T00:00:00Z')
  assertEquals(isExpiredDemo({}, now), false)
  assertEquals(isExpiredDemo({ demo_expires_at: null }, now), false)
  assertEquals(isExpiredDemo({ demo_expires_at: '' }, now), false)
  assertEquals(isExpiredDemo({ demo_expires_at: 'not-a-date' }, now), false)
  assertEquals(isExpiredDemo({ demo_expires_at: '2026-07-26T23:59:59Z' }, now), true)
})

Deno.test('isEntitledToServe: a paid row serves until its date, and not past it', () => {
  const now = new Date('2026-07-29T12:00:00Z')
  assertEquals(isEntitledToServe({ entitled_until: '2026-08-29T00:00:00Z' }, now), true)
  assertEquals(isEntitledToServe({ entitled_until: '2026-07-29T11:59:59Z' }, now), false)
})

Deno.test('isEntitledToServe: no entitlement means NOT entitled (fails closed)', () => {
  const now = new Date('2026-07-29T12:00:00Z')
  // The three shapes a row reaches this check with when nobody ever paid: the
  // column was never written, explicitly null, or blank.
  assertEquals(isEntitledToServe({}, now), false)
  assertEquals(isEntitledToServe({ entitled_until: null }, now), false)
  assertEquals(isEntitledToServe({ entitled_until: '' }, now), false)
})

Deno.test('isEntitledToServe: an unparseable date refuses service (opposite of isExpiredDemo)', () => {
  const now = new Date('2026-07-29T12:00:00Z')
  // Deliberately the other way round from isExpiredDemo, which treats garbage as
  // "no expiry". A demo wrongly taken offline is invisible; unpaid service is
  // silent revenue loss. A real customer wrongly refused complains immediately.
  assertEquals(isEntitledToServe({ entitled_until: 'not-a-date' }, now), false)
  assertEquals(isExpiredDemo({ demo_expires_at: 'not-a-date' }, now), false)
})

Deno.test('isEntitledToServe: a demo is entitled by its own date, not by payment', () => {
  const now = new Date('2026-07-29T12:00:00Z')
  // A demo has no subscription, so entitled_until is null forever. It must still
  // serve while in date, and must stop when its own TTL passes.
  assertEquals(isEntitledToServe({ is_demo: true, entitled_until: null }, now), true)
  assertEquals(
    isEntitledToServe({ is_demo: true, demo_expires_at: '2026-08-30T00:00:00Z' }, now),
    true,
  )
  assertEquals(
    isEntitledToServe({ is_demo: true, demo_expires_at: '2026-07-01T00:00:00Z' }, now),
    false,
  )
})

// ---- Follow-up mail is narrower than serving --------------------------------

Deno.test('mayReceiveFollowUp: an in-date demo that MAY serve must still never be mailed', () => {
  // The case the predicate exists for. This row passes isEntitledToServe — a
  // demo in date is entitled by construction — so anything that reused the
  // serving check as the mail check would send. A demo speaks as a named real
  // business that never consented; chatting under that name is one thing,
  // mailing their prospects under it is another.
  const now = new Date('2026-07-29T12:00:00Z')
  const inDateDemo = { is_demo: true, demo_expires_at: '2026-08-30T00:00:00Z', entitled_until: null }
  assertEquals(isEntitledToServe(inDateDemo, now), true)
  assertEquals(mayReceiveFollowUp(inDateDemo, now), false)
})

Deno.test('mayReceiveFollowUp: a demo with no expiry at all is still excluded', () => {
  // is_demo alone decides, not the expiry: a demo row that never got a TTL
  // serves forever and must still never mail.
  const now = new Date('2026-07-29T12:00:00Z')
  const row = { is_demo: true, entitled_until: null }
  assertEquals(isEntitledToServe(row, now), true)
  assertEquals(mayReceiveFollowUp(row, now), false)
})

Deno.test('mayReceiveFollowUp: a paying customer in good standing may be mailed', () => {
  const now = new Date('2026-07-29T12:00:00Z')
  assertEquals(mayReceiveFollowUp({ entitled_until: '2026-08-29T00:00:00Z' }, now), true)
  // is_demo false / absent / null all read as "not a demo".
  assertEquals(mayReceiveFollowUp({ is_demo: false, entitled_until: '2026-08-29T00:00:00Z' }, now), true)
  assertEquals(mayReceiveFollowUp({ is_demo: null, entitled_until: '2026-08-29T00:00:00Z' }, now), true)
})

Deno.test('mayReceiveFollowUp: entitlement is still required (a lapsed or unpaid row never mails)', () => {
  // Demos are excluded ON TOP of entitlement, not instead of it: a customer
  // whose subscription ended stops being mailed at the same moment their bot
  // stops answering.
  const now = new Date('2026-07-29T12:00:00Z')
  assertEquals(mayReceiveFollowUp({ entitled_until: '2026-07-29T11:59:59Z' }, now), false)
  assertEquals(mayReceiveFollowUp({ entitled_until: null }, now), false)
  assertEquals(mayReceiveFollowUp({}, now), false)
  assertEquals(mayReceiveFollowUp({ entitled_until: 'not-a-date' }, now), false)
  // An expired demo fails both halves.
  assertEquals(mayReceiveFollowUp({ is_demo: true, demo_expires_at: '2026-07-01T00:00:00Z' }, now), false)
})
