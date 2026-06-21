-- The original seed migration's "Invoice Sync" row was deleted from the
-- remote DB outside the app (admin UI only supports deactivating, not
-- deleting) at some point after 20260619000000 ran, leaving the live
-- catalog empty. Re-seeds it, guarded so this is a no-op if the row
-- already exists (e.g. on environments where it was never deleted).
insert into automations (name, summary, outcome_description, category, price_cents, currency, is_active)
select
  'Invoice Sync',
  'Automatically syncs invoices from your inbox into your accounting software.',
  'Saves about 5 hours per week of manual invoice entry and reduces data-entry errors.',
  'finance',
  49900,
  'eur',
  true
where not exists (select 1 from automations where name = 'Invoice Sync');
