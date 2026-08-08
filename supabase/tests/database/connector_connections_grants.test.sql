begin;
select plan(6);

-- The OAuth secret (Google refresh token / Slack bot token, encrypted at rest)
-- must never be reachable through PostgREST. 20260621160000 tried to enforce
-- that with a column-level REVOKE, which is a no-op against a table-level GRANT
-- (Postgres has no "table SELECT minus one column"), and 20260714000000 then
-- re-issued exactly such a table grant. 20260808090000 replaced it with
-- column-scoped SELECT. These tests are the tripwire: they fail the moment
-- anyone hands `authenticated` table-level SELECT on this table again.

select has_column('public', 'connector_connections', 'encrypted_refresh_token', 'should still have the encrypted_refresh_token column this test protects');

set local role authenticated;

-- Named-column read of the secret: denied at privilege-check time, before RLS.
select throws_ok(
  $$ select encrypted_refresh_token from public.connector_connections $$,
  '42501',
  null,
  'authenticated selecting encrypted_refresh_token should raise insufficient_privilege'
);

-- `select *` expands to every column, so it must fail too -- this is the case a
-- table-level grant would silently allow.
select throws_ok(
  $$ select * from public.connector_connections $$,
  '42501',
  null,
  'authenticated selecting * should raise insufficient_privilege (no table-level SELECT)'
);

-- Writing the secret is denied as well: no INSERT/UPDATE/DELETE is granted, the
-- edge functions do every write with the service role.
select throws_ok(
  $$ update public.connector_connections set encrypted_refresh_token = 'x' $$,
  '42501',
  null,
  'authenticated updating encrypted_refresh_token should raise insufficient_privilege'
);

-- The non-secret columns stay readable, so "you have a Google connection and it
-- is active" still works. Listing all eight granted columns also proves each
-- name in the migration's grant list really exists.
select lives_ok(
  $$ select id, customer_id, connector_type, scope, external_account_email, status, created_at, updated_at
       from public.connector_connections $$,
  'authenticated should still read the explicitly granted, non-secret columns'
);

reset role;
set local role anon;

-- Logged-out visitors get nothing at all: no policy on this table can be true
-- for them, so they hold no grant either.
select throws_ok(
  $$ select id from public.connector_connections $$,
  '42501',
  null,
  'anon should hold no privilege on connector_connections at all'
);

reset role;

select * from finish();
rollback;
