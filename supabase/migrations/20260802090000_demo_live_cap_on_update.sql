-- Close the demo live-cap bypass.
--
-- 20260730120000 caps a demo account at demo_max_live() concurrently live
-- demos. It enforces that cap in the INSERT trigger only, and counts only rows
-- that are ALREADY is_active. Neither half holds on its own:
--
--   * is_active is not coerced for a demo account on insert (deliberately — the
--     whole point of the role is that its setters may serve), so the account can
--     insert with is_active = false. Dormant rows are invisible to the count.
--   * the UPDATE branch explicitly permits a demo account to toggle is_active
--     ("retire, revive") and checks no ceiling at all.
--
-- So: insert N dormant demos, then wake them in one UPDATE. Verified against a
-- real Postgres — 120 rows inserted under the cap of 50, then all 120 activated:
--
--   nach INSERT (dormant) | live   0 | total 120
--   nach UPDATE (live)    | live 120 | total 120
--
-- Even without the dormant trick, retire-one/insert-one/revive-the-retired
-- walks past the ceiling the same way, because the count is only ever taken at
-- insert time.
--
-- The fix is to count on the transition that actually creates a live demo, not
-- only on row creation. Both triggers now share one counting function, and the
-- count excludes the row being written so an UPDATE that leaves a demo active
-- (a rename, a tone change) does not count itself and trip the ceiling at N.

-- Live demos this owner holds, ignoring one row id (the one being written).
create or replace function demo_live_count(p_owner uuid, p_exclude uuid)
returns int as $$
  select count(*)::int
    from concierges
   where owner_id = p_owner
     and is_demo
     and is_active
     and (demo_expires_at is null or demo_expires_at > now())
     and (p_exclude is null or id is distinct from p_exclude);
$$ language sql security definer stable set search_path = public, pg_temp;

create or replace function force_concierge_insert_defaults() returns trigger as $$
declare
  live_demos int;
begin
  if auth.role() is distinct from 'service_role' and not is_admin() then
    if is_demo_account() then
      new.is_demo := true;
      new.entitled_until := null;
      new.demo_expires_at := least(
        coalesce(new.demo_expires_at, now() + demo_max_lifetime()),
        now() + demo_max_lifetime()
      );

      -- Only a row that arrives ALREADY serving consumes a slot here; a dormant
      -- one is charged for at the moment it is woken, in the UPDATE trigger.
      if new.is_active then
        live_demos := demo_live_count(new.owner_id, null);
        if live_demos >= demo_max_live() then
          raise exception
            'demo account already holds % live demos (ceiling %). Retire some first.',
            live_demos, demo_max_live();
        end if;
      end if;
    else
      -- Unchanged from 20260729100000: an ordinary account creates a dormant
      -- setter and only concierge-setup, against a paid provision, wakes it.
      new.is_active := false;
      new.is_demo := false;
      new.demo_expires_at := null;
      new.entitled_until := null;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create or replace function prevent_concierge_activation_client_write() returns trigger as $$
declare
  live_demos int;
begin
  if auth.role() is distinct from 'service_role' and not is_admin() then
    if is_demo_account() then
      new.is_demo := true;
      new.entitled_until := null;
      new.demo_expires_at := least(
        coalesce(new.demo_expires_at, old.demo_expires_at, now() + demo_max_lifetime()),
        now() + demo_max_lifetime()
      );

      -- The half that was missing. Charged only on the off -> on transition, so
      -- retiring is always allowed and an ordinary edit to an already-live demo
      -- never trips the ceiling.
      if new.is_active and not old.is_active then
        live_demos := demo_live_count(new.owner_id, new.id);
        if live_demos >= demo_max_live() then
          raise exception
            'demo account already holds % live demos (ceiling %). Retire some first.',
            live_demos, demo_max_live();
        end if;
      end if;
    elsif (new.is_active is distinct from old.is_active
        or new.is_demo is distinct from old.is_demo
        or new.demo_expires_at is distinct from old.demo_expires_at
        or new.entitled_until is distinct from old.entitled_until) then
      raise exception
        'is_active, is_demo, demo_expires_at and entitled_until may only be written by the service role or an admin';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- NOTE ON THE REMAINING RACE
--
-- Two concurrent activations can still both read N-1 and both commit, landing at
-- N+1. Bounding it exactly would need a serializable read or an advisory lock on
-- owner_id, and the cap is a spend guardrail rather than an invariant — one demo
-- over on a race is not the failure mode this defends against. Recorded so the
-- next reader knows it was considered, not missed.
