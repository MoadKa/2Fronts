-- Price rule 2026-07-10: EUR 200/month for the next 7 clients (design doc
-- akaou-main-design-20260710-170429.md; ships atomically with the reinstated
-- 14-day trial and the sitewide 199 -> 200 copy sweep).
--
-- The live concierge row currently carries 19900 (EUR 199.00, set after the
-- seed migrations via the admin price editor; the 20260624050000 seed still
-- says 7900). Flip it to 20000 (EUR 200.00). Idempotent: the WHERE clause
-- re-targets the concierge row by its connector_type and is a no-op once the
-- value is set.
--
-- RUNBOOK: Wenn der 7. zahlende Kunde konvertiert: price_cents manuell auf
-- 30000 setzen (Founder-Entscheidung, siehe Design-Doc 2026-07-10).
update automations
  set price_cents = 20000
  where connector_type = 'booking_concierge'
    and price_cents is distinct from 20000;
