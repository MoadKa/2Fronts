-- Sprint D: Slack lead-notification connector + derive provision type (#13).
--
-- Three changes:
--   1. Register the slack_notifications connector in the public catalog.
--   2. Give automations a connector_type so a provision's type DERIVES from the
--      purchased automation instead of defaulting to twilio_missed_call.
--   3. Seed a Slack automation catalog entry (admin can edit its price).

-- 1. Register the Slack connector in the public Supported-software catalog. -----
insert into connector_registry (connector_type, display_name, category, status, is_public, sort_order)
values ('slack_notifications', 'Slack', 'Kommunikation', 'live', true, 15)
on conflict (connector_type) do update
  set display_name = excluded.display_name,
      category     = excluded.category,
      status       = excluded.status,
      is_public    = excluded.is_public,
      sort_order   = excluded.sort_order;

-- 2. Derive the provision type from the automation. ---------------------------
-- Until now automation_provisions.connector_type defaulted to twilio_missed_call
-- for every purchase, so only the missed-call product was truly purchasable.
-- Each automation now declares which connector fulfils it; the app reads this
-- when creating the provision row. Default keeps existing rows (the missed-call
-- product) unchanged.
alter table automations
  add column connector_type text not null default 'twilio_missed_call'
    references connector_registry(connector_type);

-- Point the existing seed automation ("Invoice Sync") at google_sheets so it is
-- a real Sheets-backed product rather than implicitly a phone-number purchase.
update automations
  set connector_type = 'google_sheets'
  where name = 'Invoice Sync';

-- 3. Seed the Slack automation (admin-configurable price via AdminCatalogPage). -
insert into automations
  (name, summary, outcome_description, category, price_cents, currency, is_active, requires_provisioning, connector_type)
select
  'Slack Lead-Benachrichtigungen',
  'Neue Leads landen sofort in deinem Slack-Channel.',
  'Jeder neue Lead wird automatisch in den gewählten Slack-Channel gepostet — keine verpassten Anfragen mehr.',
  'communication',
  4900,
  'eur',
  false, -- inactive until Slack OAuth secrets (SLACK_*) are set; flip on via AdminCatalogPage
  false,
  'slack_notifications'
where not exists (select 1 from automations where connector_type = 'slack_notifications');
