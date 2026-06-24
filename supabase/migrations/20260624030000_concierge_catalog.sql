-- AI Booking Concierge: make it a real platform automation (#24, epic #22).
--
-- Two seeds:
--   1. Register the booking_concierge connector in the public Supported-software
--      catalog so it appears alongside Sheets / Slack.
--   2. Seed the catalog automation row so a logged-in coach can buy it. Its
--      connector_type points fulfillment at the no-op booking_concierge
--      connector; requires_provisioning=true routes the buyer to the setup screen
--      (ConnectConfirmRoute -> ConciergeSetupPage) where the concierge row is
--      created. Price is EUR 79/month, charged as a one-time 7900 in this issue
--      (subscription billing is #25); the Admin catalog can edit it.

-- 1. Register the connector in the public catalog. -----------------------------
insert into connector_registry (connector_type, display_name, category, status, is_public, sort_order)
values ('booking_concierge', 'AI Booking Concierge', 'KI & Buchung', 'live', true, 5)
on conflict (connector_type) do update
  set display_name = excluded.display_name,
      category     = excluded.category,
      status       = excluded.status,
      is_public    = excluded.is_public,
      sort_order   = excluded.sort_order;

-- 2. Seed the catalog automation row. -----------------------------------------
-- 7900 = EUR 79 (one-time in test mode for #24; becomes a EUR 79/mo subscription
-- in #25). active=true so a coach can buy it immediately. requires_provisioning
-- routes the buyer through the setup screen that creates their concierges row.
insert into automations
  (name, summary, outcome_description, category, price_cents, currency, is_active, requires_provisioning, connector_type)
select
  'AI Booking Concierge',
  'Ein KI-Assistent, der deine Interessenten 24/7 berät und Termine bucht.',
  'Dein Publikum chattet auf einer eigenen Seite mit einer KI, die nur aus deinen Inhalten antwortet und direkt auf deinen Kalender bucht — in deiner Sprache, rund um die Uhr.',
  'ki-buchung',
  7900,
  'eur',
  true,
  true,
  'booking_concierge'
where not exists (select 1 from automations where connector_type = 'booking_concierge');
