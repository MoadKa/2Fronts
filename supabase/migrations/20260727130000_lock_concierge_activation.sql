-- Lock the concierge activation columns against client writes (CSO 2026-07-27,
-- finding #1).
--
-- "owners manage own concierges" (20260624020000_concierge.sql:66) is
-- `for all using (owner_id = auth.uid() or is_admin())`. Like every RLS policy
-- it constrains which ROW may be written, not which COLUMNS -- and
-- 20260714000000_explicit_data_api_grants grants UPDATE on every public table
-- to `authenticated`. So a signed-in coach could write any column on their own
-- concierge row, including the three that are not theirs to decide:
--
--   * is_active       -- the paywall. stripe-webhook deactivateSubscription()
--                        sets it false on customer.subscription.deleted, and
--                        concierge-chat serves the bot only on is_active = true.
--                        A coach who cancelled could flip it back on from the
--                        browser console and keep the service (and the operator's
--                        Gemini spend) running for free, indefinitely -- nothing
--                        re-checks Stripe at request time.
--   * is_demo         -- drives the visible "this is a demo" disclosure line
--   * demo_expires_at -- the demo TTL, both from 20260727120000
--
-- Same BEFORE UPDATE trigger pattern already used twice in this schema:
-- 20260618030000 (profiles.role) and 20260710120000 (profiles.stripe_customer_id).
-- Following the newer of the two, an unauthorized write RAISES rather than
-- silently reverting: a psql session that thinks it reactivated a concierge must
-- fail loudly, not report UPDATE 1 while the column quietly kept its old value.
--
-- Exemptions mirror the stripe_customer_id lock exactly: service_role (the edge
-- functions -- stripe-webhook is the only thing that legitimately toggles
-- is_active) and is_admin() (so an operator can repair a row without dropping to
-- the service key). search_path is pinned per the security-definer convention so
-- a schema squatting in the caller's search_path cannot shadow is_admin().
--
-- Nothing in the app breaks: the browser only ever reads concierges and inserts
-- one at setup (src/services/ConciergeService.ts). INSERT is untouched by this
-- trigger, so a new concierge still starts is_active = true by column default,
-- and every is_active write in src/ targets the `automations` catalog table, not
-- this one.
create function prevent_concierge_activation_client_write() returns trigger as $$
begin
  if (new.is_active       is distinct from old.is_active
      or new.is_demo        is distinct from old.is_demo
      or new.demo_expires_at is distinct from old.demo_expires_at)
     and auth.role() is distinct from 'service_role'
     and not is_admin() then
    raise exception 'is_active, is_demo and demo_expires_at may only be written by the service role or an admin';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create trigger concierges_lock_activation
  before update on concierges
  for each row
  execute function prevent_concierge_activation_client_write();
