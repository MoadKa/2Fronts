-- One-time bootstrap for local/dev testing: promotes the manually-created
-- admin@2fronts.dev account to admin (the role-escalation trigger added in
-- 20260618030000 blocks this via a normal client update, so it must be done
-- here with the trigger temporarily disabled), and seeds one sample
-- automation so the catalog isn't empty on first run.

alter table profiles disable trigger profiles_prevent_role_escalation;

update profiles
set role = 'admin'
where email = 'admin@2fronts.dev';

alter table profiles enable trigger profiles_prevent_role_escalation;

insert into automations (name, summary, outcome_description, category, price_cents, currency, is_active)
values (
  'Invoice Sync',
  'Automatically syncs invoices from your inbox into your accounting software.',
  'Saves about 5 hours per week of manual invoice entry and reduces data-entry errors.',
  'finance',
  49900,
  'eur',
  true
);
