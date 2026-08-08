begin;
-- Count check: 25 assertion calls live below — 1 has_table, 3 has_column,
-- 1 col_is_unique, 4 is, 1 isnt, 1 matches, 4 lives_ok, 10 throws_ok. pg_prove
-- fails the file when this number is wrong, so adding or removing an assertion
-- means editing this line too. Count with:
--   grep -cE "^\s*select \w+\(" this-file  (then subtract 1 for plan itself)
select plan(25);

-- concierge_consents is the evidence ledger for follow-up e-mail consent
-- (§7 Abs. 2 UWG). Three properties make it evidence rather than a log, and all
-- three are easy to destroy with a well-meaning one-line change, so each has a
-- tripwire here:
--
--   1. NO foreign keys. An FK's ON DELETE SET NULL issues an internal UPDATE on
--      the child row, which fires the append-only trigger, which raises -- and
--      `concierges` plus `auth.users` become permanently undeletable. The two
--      delete tests below are the reason nobody "fixes" the missing FK in six
--      months.
--   2. The coach can read the proof but not the IP, the user agent or a live
--      confirmation token. A table-level GRANT anywhere re-opens all four
--      (Postgres has no "table SELECT minus one column").
--   3. Rows never change, for anyone, service_role included. Deletion is the
--      service role's alone, for the 3-year retention purge.

-- Shape -----------------------------------------------------------------------
select has_table('public', 'concierge_consents', 'concierge_consents table should exist');
select has_column('public', 'concierge_consents', 'visitor_email_norm', 'should have visitor_email_norm (half of the subject key)');
select has_column('public', 'concierge_consents', 'sender_owner_id', 'should have sender_owner_id (survives a deleted+recreated setter)');
select has_column('public', 'concierge_consents', 'confirm_token', 'should have confirm_token (double opt-in)');
select col_is_unique('public', 'concierge_consents', 'confirm_token', 'confirm_token should be unique -- a token must identify exactly one grant');

-- The FK trap, asserted directly on the catalog as well as behaviourally below.
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.concierge_consents'::regclass and contype = 'f'),
  0,
  'concierge_consents must have NO foreign keys: ON DELETE SET NULL would UPDATE the row, the append-only trigger would raise, and concierges/auth.users would become undeletable'
);

-- The subject key is (concierge_id, visitor_email_norm), never the slug: slug is
-- owner-mutable with no trigger locking it.
select isnt(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'concierge_consents_subject_idx'),
  null,
  'concierge_consents_subject_idx should exist'
);
select matches(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'concierge_consents_subject_idx'),
  'concierge_id, visitor_email_norm, created_at DESC',
  'the subject index should be (concierge_id, visitor_email_norm, created_at desc)'
);

-- Fixtures --------------------------------------------------------------------
insert into auth.users (id, email)
  values ('11111111-1111-4111-8111-111111111111', 'pgtap-consent-owner@example.test');

insert into concierges (id, owner_id, slug, business_name, offer_description, calendar_url)
  values (
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    'pgtap-consent-ledger',
    'Test Coaching',
    'offer',
    'https://cal.example.test/pgtap'
  );

-- conversation_id deliberately points at a conversation that does not exist:
-- proof in itself that nothing enforces referential integrity here.
insert into public.concierge_consents (
  id, concierge_id, conversation_id, sender_owner_id,
  visitor_email, visitor_email_norm,
  action, source, channel,
  notice_version, notice_label, notice_text, rendered_business_name, locale,
  visitor_ip, visitor_user_agent, confirm_token, confirm_token_expires_at
) values (
  '33333333-3333-4333-8333-333333333333',
  '22222222-2222-4222-8222-222222222222',
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  'Visitor@Example.test', 'visitor@example.test',
  'granted', 'contact_form', 'email',
  'concierge-followup-email-v1', 'pgtap label', 'pgtap notice', 'Test Coaching', 'de',
  '203.0.113.7', 'Mozilla/5.0 (pgTAP)', 'pgtap-consent-token-1', now() + interval '1 day'
);

-- 1. Deleting the setter must work, and must not take the evidence with it ------
select lives_ok(
  $$ delete from public.concierges where id = '22222222-2222-4222-8222-222222222222' $$,
  'deleting a concierge must succeed -- an FK on concierge_id (any ON DELETE action) would break this permanently'
);
select is(
  (select concierge_id from public.concierge_consents where id = '33333333-3333-4333-8333-333333333333'),
  '22222222-2222-4222-8222-222222222222'::uuid,
  'the consent row survives its concierge with concierge_id still populated (no SET NULL, no CASCADE)'
);

-- 2. Same for the owner --------------------------------------------------------
select lives_ok(
  $$ delete from auth.users where id = '11111111-1111-4111-8111-111111111111' $$,
  'deleting the owner from auth.users must succeed -- an FK on sender_owner_id would make every account undeletable'
);
select is(
  (select sender_owner_id from public.concierge_consents where id = '33333333-3333-4333-8333-333333333333'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'sender_owner_id survives the owner: the ledger still names who sent, which is the point of denormalising it'
);

-- 3. What a signed-in coach may and may not read -------------------------------
set local role authenticated;

-- `select *` expands to every column, so it must fail: this is the case a
-- table-level GRANT would silently allow.
select throws_ok(
  $$ select * from public.concierge_consents $$,
  '42501',
  null,
  'authenticated selecting * should raise insufficient_privilege (no table-level SELECT)'
);

select throws_ok(
  $$ select visitor_ip from public.concierge_consents $$,
  '42501',
  null,
  'authenticated must not read visitor_ip -- collected to prove the act, not to profile the lead'
);
select throws_ok(
  $$ select visitor_user_agent from public.concierge_consents $$,
  '42501',
  null,
  'authenticated must not read visitor_user_agent'
);
select throws_ok(
  $$ select confirm_token from public.concierge_consents $$,
  '42501',
  null,
  'authenticated must not read confirm_token -- a live credential that would let a sender mint their own double opt-in'
);
select throws_ok(
  $$ select confirm_token_expires_at from public.concierge_consents $$,
  '42501',
  null,
  'authenticated must not read confirm_token_expires_at either (leaks token liveness, no screen needs it)'
);

-- Listing all fifteen granted columns also proves every name in the migration's
-- grant list really exists.
select lives_ok(
  $$ select id, concierge_id, conversation_id, sender_owner_id, visitor_email,
            visitor_email_norm, action, source, channel, notice_version,
            notice_label, notice_text, rendered_business_name, locale, created_at
       from public.concierge_consents $$,
  'authenticated should read the fifteen explicitly granted columns'
);

-- No write privilege of any kind: the service role is the only writer.
select throws_ok(
  $$ delete from public.concierge_consents $$,
  '42501',
  null,
  'authenticated deleting should raise insufficient_privilege before the trigger is even reached'
);

reset role;
set local role anon;

select throws_ok(
  $$ select id from public.concierge_consents $$,
  '42501',
  null,
  'anon should hold no privilege on concierge_consents at all'
);

reset role;

-- 4. Append-only ---------------------------------------------------------------
-- No JWT claims here, so auth.role() is null and the role GUC is 'none' -- the
-- same position the Supabase SQL editor connects from.
select throws_ok(
  $$ update public.concierge_consents set action = 'withdrawn' where id = '33333333-3333-4333-8333-333333333333' $$,
  'P0001',
  null,
  'updating a consent row should raise: evidence that can be edited is not evidence'
);
select throws_ok(
  $$ delete from public.concierge_consents where id = '33333333-3333-4333-8333-333333333333' $$,
  'P0001',
  null,
  'deleting without the service role should raise, even as the table owner'
);

-- Impersonate the service role the way this schema already documents it
-- (20260727120000, 20260729100000): a JWT claim, scoped to the transaction.
set local request.jwt.claims = '{"role":"service_role"}';

select throws_ok(
  $$ update public.concierge_consents set action = 'withdrawn' where id = '33333333-3333-4333-8333-333333333333' $$,
  'P0001',
  null,
  'UPDATE must raise for the service role too -- corrections are appended, never written over'
);

select lives_ok(
  $$ delete from public.concierge_consents where id = '33333333-3333-4333-8333-333333333333' $$,
  'the service role must still be able to delete -- the 3-year retention purge (§195 BGB) depends on it'
);
select is(
  (select count(*)::int from public.concierge_consents where id = '33333333-3333-4333-8333-333333333333'),
  0,
  'the purged row is really gone'
);

set local request.jwt.claims = '';

select * from finish();
rollback;
