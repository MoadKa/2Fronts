-- Retire the Twilio missed-call automation (2026-08-07).
--
-- Why: German prospects do not use SMS, so the product was withdrawn. The
-- connector code, both Twilio webhooks and the number-purchasing helper were
-- deleted in the same change, which means any row still pointing at
-- 'twilio_missed_call' has no delivery mechanism left.
--
-- ROLLBACK (this migration has no down file; run these by hand if reverting):
--   update automations set is_active = true where connector_type = 'twilio_missed_call';
--   update connector_registry set status = 'live' where connector_type = 'twilio_missed_call';
--   alter table automation_provisions alter column connector_type set default 'twilio_missed_call';
-- The per-row prior value of automations.is_active is NOT recoverable. In
-- practice only one twilio automation was ever seeded
-- (20260624000000_seed_launch_automations.sql), so the rollback above is exact
-- for current data.
--
-- Deliberately NOT done: automation_provisions and automation_provision_opt_outs
-- are kept, along with the twilio_* columns. No history is destroyed. See
-- TODOS.md for the two follow-ups this leaves open (releasing the Twilio numbers
-- themselves, and a retention decision on the opt-out phone numbers).
--
-- Every statement here is idempotent, because the Supabase deploy workflow in
-- this repo fails on rate limits often enough to be re-run routinely.

-- 1. Take it out of the catalog so nobody can buy it.
update automations
set is_active = false
where connector_type = 'twilio_missed_call';

-- 2. Take it out of the connector registry too. AdminCatalogPage reads this to
-- populate the connector_type picker, so leaving it 'live' would let an admin
-- create a NEW automation pointing at the retired connector.
update connector_registry
set status = 'coming_soon', is_public = false
where connector_type = 'twilio_missed_call';

-- 3. Close the in-flight funnel. create-checkout-session reads the automation by
-- id and does not consult is_active, so a request already sitting in
-- 'requested'/'payment_pending' could still be carried to Stripe and CHARGED for
-- a product that can never provision. A server-side guard was added in the same
-- change; this closes the rows that predate it.
update automation_requests
set status = 'cancelled'
where status in ('requested', 'payment_pending')
  and automation_id in (select id from automations where connector_type = 'twilio_missed_call');

-- 4. Mark surviving provisions terminal. An 'active' row would otherwise keep
-- claiming to be a working automation while its webhooks return 404.
update automation_provisions
set status = 'cancelled'
where connector_type = 'twilio_missed_call'
  and status in ('pending', 'provisioning', 'active');

-- 5. Drop the column default, which is still 'twilio_missed_call' from
-- 20260621160000 / 20260623000001.
--
-- This one is load-bearing. With the default left in place, ANY insert that
-- omits connector_type is born carrying a retired connector, and fulfillment
-- immediately marks it failed. Both self-heal inserts (stripe-webhook and
-- create-checkout-session) previously relied on that default as a fallback.
--
-- The column is NOT NULL and has been since it was added, so it has never held
-- a NULL and needs no backfill. After this, an insert that omits the column
-- errors instead of silently producing a retired row. That is the intent: both
-- self-heal sites run inside a try/catch that alerts ops with provision_missing
-- and still answers Stripe 200, so a loud alert replaces a silently dead row.
alter table automation_provisions
  alter column connector_type drop default;
