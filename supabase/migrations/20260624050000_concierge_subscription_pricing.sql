-- Make the AI Booking Concierge a real EUR 79/month subscription (#25).
--
-- The foundation seed (20260624030000_concierge_catalog.sql) created the
-- concierge automation row at price_cents=7900 but pricing_model='one_time'
-- (the default), charged as a one-time amount in #24. Now that subscription
-- billing exists (20260624040000_subscription_pricing.sql + the checkout
-- branch), flip the row to a monthly subscription. We do NOT edit the
-- foundation seed file; this is a follow-on UPDATE so the change is its own
-- revertible migration.
--
-- 7900 = EUR 79.00. Idempotent: the WHERE clause re-targets the concierge row
-- by its connector_type, so a re-run is a no-op once the values are set.
update automations
  set pricing_model = 'subscription',
      recurring_interval = 'month',
      price_cents = 7900,
      currency = 'eur'
  where connector_type = 'booking_concierge'
    and (pricing_model is distinct from 'subscription'
         or recurring_interval is distinct from 'month');
