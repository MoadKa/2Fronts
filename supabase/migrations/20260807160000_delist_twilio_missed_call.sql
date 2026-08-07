-- Retire the Twilio missed-call automation (2026-08-07).
--
-- Why: German prospects do not use SMS, so the product was withdrawn. The
-- connector code, both Twilio webhooks and the number-purchasing helper were
-- deleted in the same change, which means any row still pointing at
-- 'twilio_missed_call' has no delivery mechanism left.
--
-- ROLLBACK (this migration has no down file; run these by hand if reverting).
-- Covers all six steps:
--   update automations set is_active = true where connector_type = 'twilio_missed_call';                    -- step 1
--   update connector_registry set status = 'live', is_public = true where connector_type = 'twilio_missed_call'; -- step 2
--   alter table automation_provisions alter column connector_type set default 'twilio_missed_call';         -- step 5
--   alter table automations alter column connector_type set default 'twilio_missed_call';                   -- step 6
--
-- NOT RECOVERABLE, and no SQL above restores them:
--   * The per-row prior value of automations.is_active (step 1).
--   * The prior status of the automation_requests rows forced to 'cancelled' (step 3).
--   * The prior status of the automation_provisions rows forced to 'cancelled' (step 4).
-- Steps 3 and 4 overwrite a status column without recording what was there, so a
-- revert cannot tell a row this migration cancelled from one already cancelled.
-- With today's data that is bounded: only one twilio automation was ever seeded
-- (20260624000000_seed_launch_automations.sql) and the product has no paying
-- customers. That is a fact about current data, not a property of the migration.
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

-- 2. Take it out of the connector registry too, so anything reading the registry
-- as the catalog of available connectors stops offering it.
--
-- Note what this does NOT do: AdminCatalogPage's connector picker is a hardcoded
-- array in the frontend (src/pages/admin/AdminCatalogPage.tsx), not a read of
-- this table. The picker entry was removed in the same change; this statement
-- alone would not have closed that hole.
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
--
-- Scoped through the ownership join, NOT through
-- automation_provisions.connector_type. That column carried a DB default of
-- 'twilio_missed_call' from 20260621160000 until step 5 below drops it, and
-- 20260623000001 backfilled only automations.connector_type, never the
-- provisions. So a provision row born from the default is mislabeled twilio
-- while actually being a google_sheets or booking_concierge purchase. Selecting
-- on the column would cancel a paying customer's live automation.
update automation_provisions
set status = 'cancelled'
where status in ('pending', 'provisioning', 'active')
  and request_id in (
    select r.id
    from automation_requests r
    join automations a on a.id = r.automation_id
    where a.connector_type = 'twilio_missed_call'
  );

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

-- 6. Same default, one table over. automations.connector_type still carries
-- 'twilio_missed_call' from 20260623000001, so an automation inserted without
-- an explicit connector would be born retired — the same failure step 5 exists
-- to prevent, just for the catalog instead of the provisions. Step 1 only fixed
-- the rows that exist today, not future ones. The admin create path already
-- supplies the column, so nothing breaks.
alter table automations
  alter column connector_type drop default;
