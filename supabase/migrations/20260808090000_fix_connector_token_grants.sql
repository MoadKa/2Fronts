-- Close the connector-token read hole: connector_connections.encrypted_refresh_token
-- was readable by every signed-in user through PostgREST.
--
-- WHY THE ORIGINAL GUARD NEVER HELD
--
-- 20260621160000_add_connector_pipeline.sql protected the OAuth secret with
--
--     revoke select (encrypted_refresh_token) on connector_connections
--       from authenticated, anon;
--
-- A column-level REVOKE can only take away column-level GRANTs. It does NOT
-- subtract from a table-level GRANT: in Postgres, SELECT on the table is a
-- single, whole-table privilege that implicitly covers every column, present and
-- future. There is no such thing as "table SELECT minus one column" -- the
-- catalog cannot even express it (see pg_class.relacl vs pg_attribute.attacl).
-- So while the role holds table-level SELECT, the column revoke is a no-op that
-- reads like a security control.
--
-- It became provably dead when 20260714000000_explicit_data_api_grants.sql ran
--
--     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
--       TO anon, authenticated, service_role;
--
-- re-issuing table-level SELECT on this table. Since then, any logged-in user
-- could `select encrypted_refresh_token` (or plain `select *`) on every row RLS
-- let them see -- i.e. their own connection row -- and walk away with the
-- ciphertext of their own, and after a future RLS mistake anyone else's, Google
-- refresh token / Slack bot token.
--
-- THE ONLY SHAPE THAT ACTUALLY HIDES A COLUMN
--
-- Hold NO table-level SELECT, and grant SELECT column by column, omitting the
-- secret. That is what this migration does. Both PostgREST `select=*` and an
-- explicit `select=encrypted_refresh_token` then fail with 42501
-- (insufficient_privilege) before RLS is even consulted.
--
-- DO NOT re-add the broken pattern, and note the standing footgun: any future
-- migration that repeats `GRANT ... ON ALL TABLES IN SCHEMA public` silently
-- reopens this hole, because it hands back the table-level privilege. Such a
-- migration must exclude this table and then re-run the grants below.
-- (ALTER DEFAULT PRIVILEGES is harmless here: it only applies to tables created
-- after it, never to this existing one.)
--
-- No transaction wrapper: the Supabase CLI owns the transaction for a migration
-- file, and a nested begin;/commit; breaks it.

-- 1. Drop everything anon/authenticated hold on this table, table-level and
--    column-level alike (REVOKE ALL removes both). service_role is deliberately
--    untouched: the edge functions are the only component that legitimately
--    reads and writes the secret, and they bypass RLS and grants anyway.
revoke all privileges on table public.connector_connections from anon, authenticated;

-- 2. Hand back read access column by column -- every column of the table except
--    encrypted_refresh_token, which is the only secret material here.
--    Column list verified against the sole DDL for this table,
--    20260621160000_add_connector_pipeline.sql lines 31-42; no later migration
--    adds, renames or drops a column on connector_connections (grepped across
--    supabase/migrations). scope and external_account_email are the customer's
--    own OAuth grant metadata, shown to them on the connect/mapping screens;
--    neither is a credential.
grant select (
  id,
  customer_id,
  connector_type,
  scope,
  external_account_email,
  status,
  created_at,
  updated_at
) on table public.connector_connections to authenticated;

-- 3. Writes: none re-granted, on evidence rather than assumption.
--    The browser never writes this table -- `connector_connections` and
--    `encrypted_refresh_token` do not appear anywhere under src/ (only
--    connector_registry does, via ConnectorService/SupportedSoftwarePage). Every
--    write lives in a service-role edge function, which keeps its full grant:
--      * supabase/functions/google-oauth-callback/index.ts  -- upsert
--      * supabase/functions/slack-oauth-callback/index.ts   -- upsert
--      * supabase/functions/_shared/googleAuth.ts           -- update status
--      * supabase/functions/_shared/slackAuth.ts            -- read token
--    The "admins manage connections" RLS policy stays in place, so if an admin
--    UI ever needs to write this table from the browser, the fix is to add a
--    narrow, column-scoped grant here -- never a table-level one.
--
--    anon gets nothing at all: no RLS policy on this table can ever be true for
--    a logged-out visitor (select requires customer_id = auth.uid() or
--    is_admin()), so a grant would only widen the attack surface.
