-- Seed the launch catalog so all three automations are purchasable, each wired
-- to the correct connector. Runs after 20260623000000 (which added the
-- connector_type column, repointed "Invoice Sync" -> google_sheets, and seeded
-- the Slack automation inactive).
--
-- COPY + PRICES ARE PLACEHOLDERS — finalize names, descriptions, and prices in
-- the CEO/copywriting session. This migration only ensures the rows exist with
-- the right connector_type and active state.

-- 1. The existing google_sheets row was seeded as the sample "Invoice Sync",
--    whose copy describes invoice syncing — wrong for a lead-filing connector.
--    Re-label it to match what the connector actually does.
update automations
set
  name = 'Google Sheets Lead-Erfassung',
  summary = 'Neue Leads landen automatisch in deinem Google Sheet.',
  outcome_description = 'Jeder eingehende Lead wird sofort in deine Google-Tabelle geschrieben — kein manuelles Abtippen mehr.',
  category = 'lead-management'
where connector_type = 'google_sheets';

-- 2. Twilio missed-call recovery had no catalog row at all. Create it.
--    requires_provisioning = true because it needs a booking link at request time.
insert into automations
  (name, summary, outcome_description, category, price_cents, currency, is_active, requires_provisioning, connector_type)
select
  'Verpasste-Anrufe-Wiedergewinnung',
  'Verpasste Anrufe bekommen automatisch eine SMS mit deinem Buchungslink.',
  'Jeder verpasste Anruf erhält sofort eine Rückmeldung per SMS — kein verlorener Kunde mehr.',
  'communication',
  4900,
  'eur',
  true,
  true,
  'twilio_missed_call'
where not exists (select 1 from automations where connector_type = 'twilio_missed_call');

-- 3. Slack (slack_notifications) is already seeded by 20260623000000, inactive
--    until the SLACK_* secrets are set. Flip it active from the Admin catalog
--    once those secrets exist. No change here.
