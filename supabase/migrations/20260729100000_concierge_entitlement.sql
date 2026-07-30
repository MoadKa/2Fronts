-- Make the paywall real: entitlement decides whether a concierge serves, and the
-- client can no longer grant itself any of it.
--
-- 20260727130000 locked is_active/is_demo/demo_expires_at against client UPDATE,
-- which closed the door it aimed at. But that pattern was borrowed from
-- profiles.role (20260618030000) and profiles.stripe_customer_id
-- (20260710120000), where it is sufficient because a profile is ONE row per
-- user, created by a trigger at signup. `concierges` is one-to-MANY and the
-- browser inserts into it directly (src/services/ConciergeService.ts
-- createConcierge), so UPDATE was one of three doors. All three were open,
-- verified against a real Postgres:
--
--   1. delete own row, insert a replacement  -> is_active back to the true
--      default, same slug, so the coach's existing embed snippet keeps working.
--      Only cost is losing their own conversation history to the cascade.
--   2. don't delete anything, just insert a SECOND concierge and point the
--      website snippet at the new slug.
--   3. never pay at all. A fresh signup with zero automation_requests and zero
--      automation_provisions can insert a concierge and get a fully working
--      setter served on the operator's Gemini spend, indefinitely.
--
-- (3) is the important one: nothing server-side has ever asked whether the owner
-- paid. `is_active` was described as the paywall but only ever recorded what the
-- Stripe webhook last said, so the paywall was really the shape of the UI flow.
--
-- Two changes here, and one in each of concierge-setup and concierge-chat:
--
--   * entitled_until -- when this concierge is paid up until. Maintained by
--     stripe-webhook from subscription.current_period_end. concierge-chat
--     refuses to serve past it. Deliberately a TIMESTAMP CACHE rather than a
--     join through automation_provisions.config->>'concierge_id' (the only
--     existing link, and unindexed JSONB): the check then costs nothing on the
--     public chat path, which is the one place a prospect feels latency. And it
--     fails CLOSED -- if webhooks stop arriving the value simply lapses, where a
--     boolean would have stayed true forever.
--
--   * a BEFORE INSERT trigger that COERCES the four operator-owned columns to
--     safe values on any client insert. Coerce, not raise: the setup wizard
--     legitimately inserts and must not start erroring. A new concierge is now
--     born switched off, and only concierge-setup -- which verifies the
--     provision was actually paid -- turns it on.

alter table concierges
  add column if not exists entitled_until timestamptz;

comment on column concierges.entitled_until is
  'Paid up until. Maintained by stripe-webhook from subscription.current_period_end. '
  'concierge-chat refuses to serve past it, so a missed cancellation webhook lapses '
  'instead of granting service forever. NULL = never entitled (demos serve via '
  'is_demo + demo_expires_at instead).';

-- Grace for rows that already exist, and it MUST run here -- before the UPDATE
-- lock below learns about entitled_until.
--
-- concierge-chat starts refusing to serve a non-demo concierge whose
-- entitled_until has passed, and every existing row has NULL until the next
-- customer.subscription.updated arrives, which for an annual-ish cadence could
-- be weeks away. Failing closed on those would take live, paying customers
-- offline at deploy time, which is far worse than a freeloader keeping service
-- for another month. So existing ACTIVE, non-demo rows get one billing cycle
-- plus a few days; the webhook overwrites it with Stripe's real
-- current_period_end the first time it hears anything.
--
-- ORDER IS LOAD-BEARING. This UPDATE sat AFTER the lock in the first version and
-- the deploy failed on it: `supabase db push` connects as postgres with no JWT
-- claims, so auth.role() is not 'service_role' and is_admin() is false, and the
-- very guard this migration extends raised on the very backfill this migration
-- needs. Running it first means the lock is still the older one, which does not
-- know the column, so it has no opinion about it.
update concierges
   set entitled_until = now() + interval '35 days'
 where is_active = true
   and is_demo = false
   and entitled_until is null;

-- Extend the existing UPDATE lock to cover entitled_until. Same exemptions, same
-- raise-don't-revert posture: a session that thinks it extended entitlement must
-- fail loudly rather than report UPDATE 1 while the column kept its old value.
create or replace function prevent_concierge_activation_client_write() returns trigger as $$
begin
  if (new.is_active        is distinct from old.is_active
      or new.is_demo        is distinct from old.is_demo
      or new.demo_expires_at is distinct from old.demo_expires_at
      or new.entitled_until  is distinct from old.entitled_until)
     and auth.role() is distinct from 'service_role'
     and not is_admin() then
    raise exception 'is_active, is_demo, demo_expires_at and entitled_until may only be written by the service role or an admin';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- The missing half. Note this COERCES rather than raising, so the wizard's
-- insert still succeeds -- it just no longer decides whether it gets served.
create function force_concierge_insert_defaults() returns trigger as $$
begin
  if auth.role() is distinct from 'service_role' and not is_admin() then
    new.is_active       := false;
    new.is_demo         := false;
    new.demo_expires_at := null;
    new.entitled_until  := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create trigger concierges_force_insert_defaults
  before insert on concierges
  for each row
  execute function force_concierge_insert_defaults();

-- OPERATOR NOTE -- how to write these columns by hand.
--
-- The Supabase SQL editor connects as `postgres`, which here is NOT a superuser
-- (current_setting('is_superuser') is 'off') and carries no JWT claims, so
-- auth.role() is NULL and is_admin() is false -- both guards raise. Impersonate
-- the service role for the one statement instead:
--
--   begin;
--   set local request.jwt.claims = '{"role":"service_role"}';
--   update concierges set is_demo = true where slug in ('...');
--   commit;
--
-- Verified working. `set local` scopes it to the transaction.
