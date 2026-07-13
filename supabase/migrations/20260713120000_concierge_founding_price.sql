-- Align the concierge price with the decided founding price (billing audit
-- 2026-07-10): the catalog row still charged EUR 79/month from the #25 test
-- setup, while 2fronts.de and every outreach asset sell EUR 199/month. Anyone
-- checking out would have paid a price that exists nowhere in the marketing —
-- and 120 EUR/month under the decided model.
--
-- Pricing decision (founder, 2026-07-10): EUR 199/month founding price for the
-- first 10 customers (they keep it for as long as they stay), flat EUR 300
-- afterwards. The first-10 grandfathering is handled manually for now; the
-- catalog price becomes the founding price. The later 300 switch will be its
-- own migration when the 10th customer lands.
--
-- 19900 = EUR 199.00. Idempotent: re-running is a no-op once the value is set.
update automations
  set price_cents = 19900,
      currency = 'eur'
  where connector_type = 'booking_concierge'
    and price_cents is distinct from 19900;
