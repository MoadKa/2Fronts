begin;
-- Count check: 39 assertion calls live below -- 3 has_table, 2 has_column,
-- 3 matches, 1 isnt, 5 throws_ok, 3 lives_ok, 22 is. pg_prove fails the file when
-- this number is wrong, so adding or removing an assertion means editing this
-- line too. Count with:
--   grep -cE "^\s*select \w+\(" this-file  (then subtract 1 for plan itself)
select plan(39);

-- The follow-up send queue (20260812100000).
--
-- Four properties turn this from a job table into something that can be trusted
-- with mail, and each one is a single careless line away from being lost:
--
--   1. ONE mail per (sender, mailbox). Not per conversation -- conversations are
--      keyed on a browser-local visitor_session_id, so two tabs are two
--      conversations and one inbox. The partial unique index is the whole
--      promise; the assertions below fail the moment somebody "simplifies" it
--      into unique(conversation_id).
--   2. A row that runs out of attempts is RETIRED, not stranded. Without the
--      retirement branch in concierge_followup_claim a row whose isolate died on
--      its last attempt sits in 'sending' forever, inside the working set,
--      invisible to every backlog query.
--   3. Nothing about this queue is readable from the browser. Not a column, not
--      a row, not an RPC -- and the RPC half matters most, because all three
--      functions are SECURITY DEFINER and would bypass every table privilege.
--   4. A suppression outlives the concierge it was recorded against.
--      20260729100000's header documents delete-and-reinsert as ordinary coach
--      behaviour, so a cascade here would quietly re-permit mailing somebody who
--      unsubscribed.

-- Shape -----------------------------------------------------------------------
select has_table('public', 'concierge_followup_outbox', 'concierge_followup_outbox table should exist');
select has_table('public', 'concierge_followup_suppressions', 'concierge_followup_suppressions table should exist');
select has_table('public', 'concierge_followup_ops', 'concierge_followup_ops table should exist');

-- email_normalized is denormalised at enqueue on purpose: without it neither the
-- batch suppression lookup nor the unsubscribe cancel is expressible.
select has_column('public', 'concierge_followup_outbox', 'email_normalized',
  'outbox should carry email_normalized (denormalised at enqueue -- both lookups are keyed on it)');
select has_column('public', 'concierge_followup_outbox', 'sent_consent_text',
  'outbox should snapshot sent_consent_text -- a pointer to the current wording proves nothing about what this recipient got');

-- No foreign keys, on either table, for reasons documented at length in the
-- migration. Asserted on the catalog as well as behaviourally at the bottom.
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.concierge_followup_outbox'::regclass and contype = 'f'),
  0,
  'the outbox must have NO foreign keys: a cascade from concierges would erase the record of a mail we really sent, and consent_id points into a ledger with a 3-year purge'
);
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.concierge_followup_suppressions'::regclass and contype = 'f'),
  0,
  'suppressions must have NO foreign key to concierges: cascading would delete the record of an objection along with the sender row'
);

-- The once-ness index.
select isnt(
  (select indexdef from pg_indexes
    where schemaname = 'public'
      and indexname = 'concierge_followup_outbox_one_sent_per_recipient_idx'),
  null,
  'concierge_followup_outbox_one_sent_per_recipient_idx should exist'
);
select matches(
  (select indexdef from pg_indexes
    where schemaname = 'public'
      and indexname = 'concierge_followup_outbox_one_sent_per_recipient_idx'),
  'concierge_id, email_normalized',
  'once-ness is keyed on (concierge_id, email_normalized) -- the recipient''s inbox, not the conversation'
);
select matches(
  (select indexdef from pg_indexes
    where schemaname = 'public'
      and indexname = 'concierge_followup_outbox_one_sent_per_recipient_idx'),
  'status = ''sent''',
  'the index must be PARTIAL on status = ''sent'': failed and cancelled rows have to be able to coexist for the same recipient'
);

-- RLS on with zero policies, the concierge_rate_limits pattern. This is the
-- second lock behind the revokes: a future migration re-running
-- `GRANT ... ON ALL TABLES IN SCHEMA public` hands the grant back, and only the
-- empty policy set still returns zero rows.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('concierge_followup_outbox', 'concierge_followup_suppressions', 'concierge_followup_ops')),
  0,
  'all three tables should have RLS enabled with ZERO policies -- no policy means no row for anyone but service_role'
);

-- Ships off. Asserted before the fixtures switch it on.
select is(
  (select sending_enabled from public.concierge_followup_ops where id = 1),
  false,
  'the stop switch must ship disabled -- the worst bug this pipeline can have is sending something it should not have'
);

-- What the browser may reach ---------------------------------------------------
select is(
  has_table_privilege('anon', 'public.concierge_followup_outbox', 'select'),
  false,
  'anon must hold no SELECT privilege on the outbox at all'
);

set local role anon;

select throws_ok(
  $$ select id from public.concierge_followup_outbox $$,
  '42501',
  null,
  'anon selecting from the outbox should raise insufficient_privilege (sent_body is a private message to a third party)'
);

select throws_ok(
  $$ select concierge_id from public.concierge_followup_suppressions $$,
  '42501',
  null,
  'anon selecting the suppression list should raise -- it is a list of people who objected'
);

-- The one that matters most. All three functions are SECURITY DEFINER, so they
-- bypass the table privileges above entirely; the EXECUTE revoke from PUBLIC is
-- the only gate. An anon-callable unsubscribe is a denial-of-lead endpoint with
-- no authentication: any script could suppress any address for any coach.
select throws_ok(
  $$ select public.concierge_followup_unsubscribe(
       '22222222-2222-4222-8222-222222222222'::uuid, 'anyone@example.test', 'operator') $$,
  '42501',
  null,
  'anon must not be able to EXECUTE concierge_followup_unsubscribe -- SECURITY DEFINER bypasses every table grant, so the revoke from PUBLIC is the whole lock'
);

reset role;

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email)
  values ('11111111-1111-4111-8111-111111111111', 'pgtap-outbox-owner@example.test');

insert into concierges (id, owner_id, slug, business_name, offer_description, calendar_url)
  values (
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    'pgtap-followup-outbox',
    'Test Coaching',
    'offer',
    'https://cal.example.test/pgtap'
  );

update public.concierge_followup_ops
   set sending_enabled = true, updated_at = now()
 where id = 1;

-- A: due, fresh                      -> claimed
-- B: scheduled a day out             -> not a candidate at all
-- C: stale 'sending', attempts at 3  -> RETIRED to failed, never returned
-- D: stale 'sending', attempts 1     -> reclaimed
-- E: pending but already expired     -> cancelled, never returned
insert into public.concierge_followup_outbox
  (id, concierge_id, conversation_id, email_normalized, scheduled_at, expires_at, status, attempts, claimed_at)
values
  ('aaaaaaaa-0000-4000-8000-00000000000a', '22222222-2222-4222-8222-222222222222',
   'cccccccc-0000-4000-8000-00000000000a', 'due@example.test',
   now() - interval '5 minutes', now() + interval '1 day', 'pending', 0, null),
  ('bbbbbbbb-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'cccccccc-0000-4000-8000-00000000000b', 'later@example.test',
   now() + interval '1 day', now() + interval '2 days', 'pending', 0, null),
  ('cccccccc-0000-4000-8000-00000000000c', '22222222-2222-4222-8222-222222222222',
   'cccccccc-0000-4000-8000-00000000000d', 'exhausted@example.test',
   now() - interval '2 hours', now() + interval '1 day', 'sending', 3, now() - interval '1 hour'),
  ('dddddddd-0000-4000-8000-00000000000d', '22222222-2222-4222-8222-222222222222',
   'cccccccc-0000-4000-8000-00000000000e', 'abandoned@example.test',
   now() - interval '2 hours', now() + interval '1 day', 'sending', 1, now() - interval '1 hour'),
  ('eeeeeeee-0000-4000-8000-00000000000e', '22222222-2222-4222-8222-222222222222',
   'cccccccc-0000-4000-8000-00000000000f', 'expired@example.test',
   now() - interval '10 minutes', now() - interval '1 minute', 'pending', 0, null);

-- Claiming ----------------------------------------------------------------------
create temp table claim_batch_1 as
  select * from public.concierge_followup_claim(10, now());

select is(
  (select count(*)::int from claim_batch_1),
  2,
  'the claim should return exactly the two workable rows (due + abandoned), and nothing else'
);

select is(
  (select count(*)::int from claim_batch_1 where id = 'cccccccc-0000-4000-8000-00000000000c'),
  0,
  'a stale sending row at max attempts must NOT be handed out again -- it can never succeed and every claim would burn a delivery attempt'
);

select is(
  (select status from public.concierge_followup_outbox where id = 'cccccccc-0000-4000-8000-00000000000c'),
  'failed',
  'that row must be RETIRED to failed by the same statement. Without this branch it matches neither the pending nor the stale-sending predicate and sits in sending forever, invisible'
);

select is(
  (select status from public.concierge_followup_outbox where id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
  'sending',
  'a claimed row should be flipped to sending, so a second worker sees it as taken'
);

select is(
  (select attempts from public.concierge_followup_outbox where id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
  1,
  'claiming burns an attempt -- the counter is what eventually retires a row nobody can deliver'
);

select is(
  (select count(*)::int from claim_batch_1 where id = 'bbbbbbbb-0000-4000-8000-00000000000b'),
  0,
  'a row scheduled in the future must not be claimed early'
);

select is(
  (select status from public.concierge_followup_outbox where id = 'eeeeeeee-0000-4000-8000-00000000000e'),
  'cancelled',
  'an expired pending row is cancelled, not sent: a follow-up to a three-week-old chat is cold mail, which is the thing UWG forbids'
);

-- SKIP LOCKED, asserted two ways.
--
-- A pgTAP file is ONE transaction and this project has no dblink, so a second
-- genuinely concurrent session cannot be opened from here. What is asserted
-- instead is the invariant that skip locked exists to protect -- a claimed row is
-- never handed to a second claimer -- plus the presence of the clause itself in
-- the function body, so a rewrite that drops it fails here rather than in
-- production as duplicate mail.
select matches(
  pg_get_functiondef('public.concierge_followup_claim(integer, timestamp with time zone)'::regprocedure),
  'skip locked',
  'the claim must use FOR UPDATE SKIP LOCKED -- without it concurrent workers serialise, and with a plain FOR UPDATE the second worker blocks and then re-reads the same rows'
);

create temp table claim_batch_2 as
  select * from public.concierge_followup_claim(10, now());

select is(
  (select count(*)::int from claim_batch_2),
  0,
  'a second claim in the same window gets nothing: every workable row is already held'
);

select is(
  (select count(*)::int from (
     select id from claim_batch_1 intersect select id from claim_batch_2
   ) both_batches),
  0,
  'two overlapping claims must return DISJOINT sets -- one row handed to two workers is two mails to one inbox'
);

-- The stop switch.
update public.concierge_followup_ops set sending_enabled = false, updated_at = now() where id = 1;

insert into public.concierge_followup_outbox
  (id, concierge_id, email_normalized, scheduled_at, expires_at, status)
values
  ('ffffffff-0000-4000-8000-00000000000f', '22222222-2222-4222-8222-222222222222',
   'afterstop@example.test', now() - interval '1 minute', now() + interval '1 day', 'pending');

select is(
  (select count(*)::int from public.concierge_followup_claim(10, now())),
  0,
  'with sending_enabled false the claim returns nothing at all -- one UPDATE stops the pipeline, no deploy'
);

-- Once ---------------------------------------------------------------------------
-- conversation_id left null on both: nulls are distinct in a unique constraint,
-- so the only thing that can reject the second row is the partial index.
select lives_ok(
  $$ insert into public.concierge_followup_outbox
       (concierge_id, email_normalized, scheduled_at, expires_at, status, sent_at)
     values ('22222222-2222-4222-8222-222222222222', 'once@example.test',
             now() - interval '1 hour', now() + interval '1 day', 'sent', now()) $$,
  'the first sent mail to an address should be recordable'
);

select throws_ok(
  $$ insert into public.concierge_followup_outbox
       (concierge_id, email_normalized, scheduled_at, expires_at, status, sent_at)
     values ('22222222-2222-4222-8222-222222222222', 'once@example.test',
             now(), now() + interval '1 day', 'sent', now()) $$,
  '23505',
  null,
  'a SECOND sent row for the same (concierge, email) must be rejected -- this index, not unique(conversation_id), is what makes "eine einzige E-Mail" true when one person opens two tabs'
);

select lives_ok(
  $$ insert into public.concierge_followup_outbox
       (concierge_id, email_normalized, scheduled_at, expires_at, status)
     values ('22222222-2222-4222-8222-222222222222', 'once@example.test',
             now(), now() + interval '1 day', 'pending') $$,
  'a pending row for an already-mailed address is still allowed -- the index is partial, and the refusal has to happen at send time so the reason is recordable'
);

-- Unsubscribe ---------------------------------------------------------------------
insert into public.concierge_followup_outbox
  (id, concierge_id, email_normalized, scheduled_at, expires_at, status)
values
  ('99999999-0000-4000-8000-000000000099', '22222222-2222-4222-8222-222222222222',
   'unsub@example.test', now() + interval '1 hour', now() + interval '1 day', 'pending');

select is(
  public.concierge_followup_unsubscribe(
    '22222222-2222-4222-8222-222222222222'::uuid, '  UnSub@Example.test ', 'visitor_unsubscribe'),
  1,
  'unsubscribing should cancel the one queued mail and report it (the address is lowercased + trimmed exactly as normalizeConsentEmail does)'
);

select is(
  (select count(*)::int from public.concierge_followup_suppressions
    where concierge_id = '22222222-2222-4222-8222-222222222222'
      and email_normalized = 'unsub@example.test'),
  1,
  'unsubscribing records the suppression'
);

select is(
  (select status || '/' || coalesce(cancel_reason, '-')
     from public.concierge_followup_outbox where id = '99999999-0000-4000-8000-000000000099'),
  'cancelled/unsubscribed',
  'and cancels the queued row in the same call: recording the objection while leaving the mail queued would send the very mail they just asked us not to send'
);

-- Batch suppression lookup ---------------------------------------------------------
select is(
  (select count(*)::int from public.concierge_followup_suppressed(
     ('[{"concierge_id":"22222222-2222-4222-8222-222222222222","email":"UNSUB@Example.test"}]')::jsonb)),
  1,
  'concierge_followup_suppressed finds the pair regardless of the caller''s casing'
);

select is(
  (select count(*)::int from public.concierge_followup_suppressed(
     ('[{"concierge_id":"22222222-2222-4222-8222-222222222222","email":"never-heard-of@example.test"}]')::jsonb)),
  0,
  'an address that never objected is simply not returned'
);

-- The reason this is an RPC taking JSON and not a PostgREST filter. isEmail in
-- concierge-chat/index.ts:344 is /^[^\s@]+@[^\s@]+\.[^\s@]+$/ -- it rejects
-- whitespace and a second @, and nothing else -- so this really is an address the
-- system accepts today. Interpolated into a .or() filter string it would close
-- the and() and open a new disjunct, and the lookup would quietly match nothing,
-- which reads as "not suppressed" and mails somebody who said no.
insert into public.concierge_followup_suppressions (concierge_id, email_normalized, source)
  values ('22222222-2222-4222-8222-222222222222', 'a,b)@x.de', 'provider_bounce');

select is(
  (select count(*)::int from public.concierge_followup_suppressed(
     ('[{"concierge_id":"22222222-2222-4222-8222-222222222222","email":"A,B)@x.de"}]')::jsonb)),
  1,
  'an address containing a comma and a closing paren is matched literally -- it is a value here, never part of a filter grammar'
);

-- Fail closed on garbage: an empty result is the sentence "none of these are
-- suppressed", i.e. an instruction to send. Malformed input must not be able to
-- produce it.
select throws_ok(
  $$ select * from public.concierge_followup_suppressed('{"concierge_id":"x"}'::jsonb) $$,
  'P0001',
  null,
  'a non-array argument must RAISE, not return zero rows -- zero rows means "send them all"'
);

-- The suppression outlives the sender -----------------------------------------------
select lives_ok(
  $$ delete from public.concierges where id = '22222222-2222-4222-8222-222222222222' $$,
  'deleting the concierge must succeed -- any FK from these tables would eventually make setters undeletable'
);

select is(
  (select count(*)::int from public.concierge_followup_suppressions
    where concierge_id = '22222222-2222-4222-8222-222222222222'),
  2,
  'the suppressions survive their concierge. 20260729100000 records delete-and-reinsert as ordinary coach behaviour, and a cascade here would re-permit mailing everyone who had unsubscribed'
);

select * from finish();
rollback;
