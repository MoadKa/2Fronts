// Whether a concierge row is allowed to be served, and to be mailed about.
//
// These predicates used to live inside concierge-chat/index.ts. They are here
// because that module imports the Gemini client at module scope: anything that
// wanted to reuse the entitlement rules — the follow-up mail path in particular
// — would have dragged the LLM client into its bundle, and "no model call in the
// send path" would have been false the day it was written. This module has no
// dependencies at all, so importing it costs nothing but the rules themselves.
//
// concierge-chat re-exports isExpiredDemo / isEntitledToServe, so its existing
// call sites and tests keep importing them from there.

// A sales-demo concierge stops serving on its own date (migration
// 20260727120000). Checked here rather than as a query filter for two reasons:
// the owner must still be able to READ and revive an expired row, and the rule
// then lives in one testable place instead of being duplicated across the probe
// query and the main load query.
//
// NULL / absent expiry = never expires, which is every real customer row.
export function isExpiredDemo(
  row: { demo_expires_at?: string | null },
  now: Date,
): boolean {
  const expiresAt = row.demo_expires_at
  if (typeof expiresAt !== 'string' || expiresAt === '') return false
  const parsed = Date.parse(expiresAt)
  // An unparseable timestamp must not silently take a demo offline; treat it as
  // "no expiry" and let the row keep serving.
  if (Number.isNaN(parsed)) return false
  return parsed <= now.getTime()
}

// Whether this concierge is currently PAID FOR (migration 20260729100000).
//
// is_active alone was never a paywall. It only records what the Stripe webhook
// last said, so a webhook that never arrived -- dropped, retried past its
// window, or simply never sent because the row was created without a purchase
// at all -- left the bot serving on the operator's model spend forever. The
// three insert paths that produced such a row are closed at the database now,
// but that only stops NEW ones; this is the check that decides whether a row
// gets served, whatever put it there.
//
// A demo has no subscription and is bounded by isExpiredDemo instead, so it is
// entitled by construction while it is still in date.
//
// NULL entitled_until on a non-demo row = NOT entitled. That is the whole point:
// the value lapses on its own, so a missed cancellation stops being permanent
// free service. Existing rows are backfilled with a grace window by the
// migration so nobody is cut off at deploy time.
export function isEntitledToServe(
  row: { is_demo?: boolean | null; demo_expires_at?: string | null; entitled_until?: string | null },
  now: Date,
): boolean {
  if (row.is_demo === true) return !isExpiredDemo(row, now)

  const until = row.entitled_until
  if (typeof until !== 'string' || until === '') return false
  const parsed = Date.parse(until)
  // Unparseable cuts the OTHER way from isExpiredDemo. There, a bad value must
  // not take a demo offline; here, a bad value must not hand out unpaid service
  // -- and unlike a demo, a real customer being wrongly refused is visible and
  // gets reported, where a freeloader never will be.
  if (Number.isNaN(parsed)) return false
  return parsed > now.getTime()
}

// Whether a concierge may send a follow-up EMAIL to its visitors. Strictly
// narrower than isEntitledToServe: entitlement is necessary, and demos are
// excluded on top of it.
//
// A demo is a concierge we set up ourselves for a prospect, speaking as a named
// real business that never asked for it -- /c/singularitysales is a live one. A
// chatbot answering on that page is already borrowing the name; sending mail
// FROM that name to their prospects is a different act, on a channel we cannot
// take back, to people who never opened the page. So a demo chats and never
// mails, whatever its expiry says.
export function mayReceiveFollowUp(
  row: { is_demo?: boolean | null; demo_expires_at?: string | null; entitled_until?: string | null },
  now: Date,
): boolean {
  return isEntitledToServe(row, now) && row.is_demo !== true
}
