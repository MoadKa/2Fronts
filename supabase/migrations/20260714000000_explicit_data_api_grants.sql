-- Explicit Data API grants.
--
-- Every migration in this project relies on Supabase's legacy "auto-expose new
-- tables" behaviour: tables created in `public` were implicitly reachable by the
-- Data API roles (`anon`, `authenticated`, `service_role`) with no GRANT ever
-- written. That default is deprecated and is REMOVED on 2026-10-30 (see the
-- `auto_expose_new_tables` note in supabase/config.toml). After that date, and on
-- any fresh project / newer CLI today, a project with no explicit grants denies
-- every table with `permission denied for table ...` — the whole app breaks
-- (catalog won't load, checkout can't insert a request, nothing works).
--
-- This migration makes the implicit grants explicit, exactly mirroring what
-- auto-expose granted, so the app no longer depends on the deprecated default.
-- RLS stays the real access gate: every public table has RLS enabled, so these
-- role-level grants only make tables *reachable* through PostgREST — which rows
-- each role can actually touch is still decided by the RLS policies.
--
-- Idempotent: GRANT/ALTER DEFAULT PRIVILEGES are safe to re-run. Applies to all
-- current objects plus a default-privileges rule for anything future migrations
-- add (so we never regress to the implicit-grant trap again).

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO anon, authenticated, service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  TO anon, authenticated, service_role;

-- Future objects created by the migration role (postgres) inherit the same
-- grants, so a new table added by a later migration is exposed automatically —
-- the behaviour auto-expose used to provide.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
