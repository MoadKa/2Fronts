-- A role for the demo console: may create SERVING setters, but only ones that
-- announce themselves as demos and expire on their own.
--
-- WHY A ROLE AND NOT AN EXEMPTION
--
-- 20260729100000 made every client-inserted concierge start dormant, which is
-- what closed the paywall. The sales console creates setters as an ordinary
-- signed-in account, so that fix also switches the console off: a demo it builds
-- would never answer.
--
-- The obvious repair is to give the console account `admin`, since both triggers
-- already exempt is_admin(). Measured against the live schema, that role is
-- referenced by 19 policies. Granting it to open one door opens nineteen, on an
-- account whose password lives in a .env on a laptop.
--
-- The second-most-obvious repair is a `demo` role that the triggers simply skip.
-- That is worse than it looks. A skipped trigger means the account may also write
-- demo_expires_at = now() + 100 years (a demo that never dies) and entitled_until
-- = far future — which is a setter that reads as PAID. That is precisely the hole
-- 20260729100000 closed, handed back with a key.
--
-- So this role is not exempt from anything. It is COERCED:
--
--   is_demo         forced true   -- cannot build a setter that hides what it is
--   entitled_until  forced null   -- cannot grant itself paid standing, ever
--   demo_expires_at clamped       -- cannot outlive the window below
--   is_active       left alone    -- may serve; that is the whole point
--
-- The security property is therefore structural rather than contractual: this
-- role cannot EXPRESS a permanent, undisclosed, or paid-looking setter. Worst
-- case on a leaked credential is demo spam that is visibly demo and self-expires.
--
-- Blast radius of that leak, checked rather than assumed: no RLS policy for
-- `authenticated` on this schema is unscoped by auth.uid(), so the account
-- reaches none of its own rows' neighbours — no customer setters, no
-- conversations, no requests.

-- How long a demo may live. Also the ceiling the clamp enforces, so a caller
-- asking for longer silently gets this instead of an error: the console has no
-- legitimate reason to ask for more, and failing the insert would only teach
-- whoever holds the credential where the boundary sits.
create or replace function demo_max_lifetime() returns interval as $$
  select interval '30 days';
$$ language sql immutable;

-- How many live demos one demo account may hold at once. Each individual demo is
-- already capped at 1000 model calls a day by the per-concierge spend cap, so
-- this bounds the OTHER axis: how many of those caps can be run in parallel.
-- Generous for the founder, tight for someone with a stolen .env.
create or replace function demo_max_live() returns int as $$
  select 50;
$$ language sql immutable;

alter table profiles drop constraint if exists profiles_role_check;
do $$
declare cname text;
begin
  -- The original constraint was created unnamed, so its generated name differs
  -- between a fresh `db reset` and the long-lived production database. Find it
  -- by shape instead of guessing.
  select conname into cname
    from pg_constraint
   where conrelid = 'profiles'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%role%';
  if cname is not null then
    execute format('alter table profiles drop constraint %I', cname);
  end if;
end $$;

alter table profiles
  add constraint profiles_role_check check (role in ('customer', 'admin', 'demo'));

-- Make the role lock reachable by the deploy path, matching the two later locks.
--
-- prevent_role_self_escalation (20260618030000) exempts is_admin() ONLY. The two
-- column locks written after it (profiles.stripe_customer_id 20260710120000 and
-- concierges activation 20260727130000) exempt service_role AND is_admin. That
-- inconsistency means profiles.role is the one column no deployment, migration or
-- edge function can set — the silent revert makes it look like it worked, which
-- is how this was found: promoting the console account appeared to succeed and
-- the row still read 'customer'.
--
-- This is not a loosening. service_role already bypasses RLS on every table; a
-- trigger that blocks it does not protect anything, it only forces whoever holds
-- the key to reach for a workaround. The self-escalation guard this was written
-- for is untouched: a signed-in customer still cannot change their own role, and
-- the revert stays silent for them so nothing leaks about the check.
create or replace function prevent_role_self_escalation() returns trigger as $$
begin
  if new.role is distinct from old.role
     and auth.role() is distinct from 'service_role'
     and not is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- Mirrors is_admin() (20260618000000). security definer + pinned search_path so a
-- schema squatting in the caller's path cannot shadow `profiles` and make every
-- caller look like a demo account.
create or replace function is_demo_account() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'demo'
  );
$$ language sql security definer stable set search_path = public, pg_temp;

-- INSERT: coerce rather than reject, so the console's insert still succeeds and
-- simply cannot decide what it produces.
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

      -- Counted over this owner's own live demos. Raises rather than coercing:
      -- silently dropping a demo the operator asked for would be a worse
      -- surprise than an error naming the ceiling.
      select count(*) into live_demos
        from concierges
       where owner_id = new.owner_id
         and is_demo
         and is_active
         and (demo_expires_at is null or demo_expires_at > now());
      if live_demos >= demo_max_live() then
        raise exception
          'demo account already holds % live demos (ceiling %). Retire some first.',
          live_demos, demo_max_live();
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

-- UPDATE: same coercion, so a demo account cannot edit its way past the rules it
-- could not insert past. Everyone else keeps the hard refusal.
create or replace function prevent_concierge_activation_client_write() returns trigger as $$
begin
  if auth.role() is distinct from 'service_role' and not is_admin() then
    if is_demo_account() then
      -- May switch its own demo off and on (retire, revive) — RLS already limits
      -- that to rows it owns — but the three columns that decide disclosure,
      -- lifetime and paid standing are not its call on update either.
      new.is_demo := true;
      new.entitled_until := null;
      new.demo_expires_at := least(
        coalesce(new.demo_expires_at, old.demo_expires_at, now() + demo_max_lifetime()),
        now() + demo_max_lifetime()
      );
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

-- OPERATOR NOTE
--
-- Promote the console's account once, as the service role (the SQL editor
-- connects as `postgres`, which is not a superuser here and carries no JWT
-- claims, so profiles.role's own lock from 20260618030000 refuses it):
--
--   begin;
--   set local request.jwt.claims = '{"role":"service_role"}';
--   update profiles set role = 'demo' where email = 'demo-console@2fronts.de';
--   commit;
--
-- Only ever promote an account that owns NOTHING but demos. The UPDATE branch
-- above forces is_demo = true on any row the account touches, so promoting a
-- real coach would relabel their paid setter as a demo the next time anything
-- edited it.
