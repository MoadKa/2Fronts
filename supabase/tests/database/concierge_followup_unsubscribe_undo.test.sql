begin;
-- Count check: 24 assertion calls live below -- 1 has_function, 19 is,
-- 3 throws_ok, 1 lives_ok. pg_prove fails the file when this number is wrong, so
-- adding or removing an assertion means editing this line too. Count with:
--   grep -cE "^\s*select \w+\(" this-file  (then subtract 1 for plan itself)
select plan(24);

-- concierge_followup_unsubscribe_undo (20260812110000) is the way back out of an
-- unsubscribe nobody asked for: the sibling endpoint acts on a bare GET, so
-- Outlook Safe Links, Proofpoint and Mimecast can retire a follow-up the
-- recipient was happy to receive before they ever opened the mail. This function
-- is the price paid for that trade, and it points in the dangerous direction --
-- mail somebody stopped starts again -- so every limit on it is load-bearing:
--
--   1. ONLY A VISITOR'S OWN CLICK IS UNDOABLE. A 'provider_bounce' says the
--      mailbox rejected us; an 'operator' row is usually the answer to a
--      complaint. Neither is a state the holder of a link is entitled to
--      reverse, and a URL that could reverse them would be a way to re-enable
--      mail to an address suppressed for reasons its owner does not control.
--   2. THE RE-QUEUE HAS THREE GUARDS, and dropping any one of them sends a mail:
--      the wrong cancel_reason revives a row cancelled for an unrelated reason,
--      a missing expiry check turns a three-week-old chat into cold mail (which
--      is the thing §7 Abs. 2 UWG forbids), and a missing sent-row check moves
--      the partial unique index's collision from a no-op here to a failed send.
--   3. NOTHING IN THE BROWSER MAY CALL IT. The function is SECURITY DEFINER and
--      bypasses the zero-policy RLS on the suppression table entirely, so the
--      EXECUTE revoke from PUBLIC is the whole gate. An anon-callable version
--      would let any script on the internet delete anybody's objection and
--      re-queue mail to them -- a worse endpoint than the one it undoes.
--
-- The DELETE and the re-queue UPDATE are two independent statements, and the
-- assertions below pin that down in both directions: a call can lift a
-- suppression without restoring anything (nothing was queued, or the row is
-- expired or already sent), and it can restore a row without lifting anything
-- (see the provider_bounce block, which documents an audited interaction with
-- resend-webhook).

-- Shape -----------------------------------------------------------------------
select has_function(
  'public', 'concierge_followup_unsubscribe_undo', array['uuid', 'text'],
  'concierge_followup_unsubscribe_undo(uuid, text) should exist -- the unsubscribe endpoint calls it by name on POST ?undo=1, and a missing one renders the neutral page and leaves the suppression standing'
);

-- What the browser may reach ---------------------------------------------------
select is(
  has_function_privilege('anon', 'public.concierge_followup_unsubscribe_undo(uuid, text)', 'execute'),
  false,
  'anon must hold no EXECUTE privilege on the undo'
);
select is(
  has_function_privilege('authenticated', 'public.concierge_followup_unsubscribe_undo(uuid, text)', 'execute'),
  false,
  'authenticated must hold no EXECUTE privilege either -- a signed-in coach undoing their own leads'' unsubscribes is exactly the abuse this forbids'
);
select is(
  has_function_privilege('service_role', 'public.concierge_followup_unsubscribe_undo(uuid, text)', 'execute'),
  true,
  'the service role must keep EXECUTE -- the edge function is the only legitimate caller'
);

set local role anon;

select throws_ok(
  $$ select public.concierge_followup_unsubscribe_undo(
       '22222222-2222-4222-8222-222222222222'::uuid, 'anyone@example.test') $$,
  '42501',
  null,
  'anon must not be able to EXECUTE the undo -- SECURITY DEFINER bypasses every table grant and the zero-policy RLS, so the revoke from PUBLIC is the only lock'
);

reset role;
set local role authenticated;

select throws_ok(
  $$ select public.concierge_followup_unsubscribe_undo(
       '22222222-2222-4222-8222-222222222222'::uuid, 'anyone@example.test') $$,
  '42501',
  null,
  'authenticated must not be able to EXECUTE the undo either'
);

reset role;

-- Fail closed on a missing address ---------------------------------------------
-- Not cosmetic: an empty v_norm would otherwise match no suppression and no
-- outbox row and report success, and the endpoint would render "undone" for a
-- call that did nothing.
select throws_ok(
  $$ select public.concierge_followup_unsubscribe_undo(
       '22222222-2222-4222-8222-222222222222'::uuid, '   ') $$,
  'P0001',
  null,
  'an empty or whitespace-only address must RAISE, not quietly report an undo that never happened'
);

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email)
  values ('11111111-1111-4111-8111-111111111111', 'pgtap-undo-owner@example.test');

insert into concierges (id, owner_id, slug, business_name, offer_description, calendar_url)
  values (
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    'pgtap-followup-undo',
    'Test Coaching',
    'offer',
    'https://cal.example.test/pgtap'
  );

-- One address per property, because the suppression table is keyed
-- (concierge_id, email_normalized) and one row per address is all it can hold.
insert into public.concierge_followup_suppressions (concierge_id, email_normalized, source)
values
  ('22222222-2222-4222-8222-222222222222', 'visitor@example.test',   'visitor_unsubscribe'),
  ('22222222-2222-4222-8222-222222222222', 'bounced@example.test',   'provider_bounce'),
  ('22222222-2222-4222-8222-222222222222', 'operator@example.test',  'operator'),
  ('22222222-2222-4222-8222-222222222222', 'withdrawn@example.test', 'visitor_unsubscribe'),
  ('22222222-2222-4222-8222-222222222222', 'stale@example.test',     'visitor_unsubscribe'),
  ('22222222-2222-4222-8222-222222222222', 'mailed@example.test',    'visitor_unsubscribe');

-- conversation_id is left null throughout: nulls are distinct in a unique
-- constraint, so several rows can coexist for one address and none of the
-- properties below is accidentally enforced by unique(conversation_id).
insert into public.concierge_followup_outbox
  (id, concierge_id, email_normalized, scheduled_at, expires_at, status, cancel_reason, sent_at)
values
  -- Cancelled by the visitor's own click, still in date: the only shape that revives.
  ('aaaaaaaa-0000-4000-8000-0000000000a1', '22222222-2222-4222-8222-222222222222',
   'visitor@example.test', now() + interval '1 hour', now() + interval '1 day',
   'cancelled', 'unsubscribed', null),
  -- Cancelled by the bounce webhook, which calls the same RPC and therefore
  -- writes the same cancel_reason. See the audit note below.
  ('aaaaaaaa-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
   'bounced@example.test', now() + interval '1 hour', now() + interval '1 day',
   'cancelled', 'unsubscribed', null),
  -- Cancelled for an unrelated reason: the coach's consent was withdrawn.
  ('aaaaaaaa-0000-4000-8000-0000000000c1', '22222222-2222-4222-8222-222222222222',
   'withdrawn@example.test', now() + interval '1 hour', now() + interval '1 day',
   'cancelled', 'consent_withdrawn', null),
  -- Cancelled by an unsubscribe, but the conversation has gone cold.
  ('aaaaaaaa-0000-4000-8000-0000000000d1', '22222222-2222-4222-8222-222222222222',
   'stale@example.test', now() - interval '3 weeks', now() - interval '1 minute',
   'cancelled', 'unsubscribed', null),
  -- A pair that already got its one mail, plus a cancelled row beside it. The
  -- partial unique index allows exactly this coexistence.
  ('aaaaaaaa-0000-4000-8000-0000000000e1', '22222222-2222-4222-8222-222222222222',
   'mailed@example.test', now() - interval '2 hours', now() + interval '1 day',
   'sent', null, now() - interval '1 hour'),
  ('aaaaaaaa-0000-4000-8000-0000000000f1', '22222222-2222-4222-8222-222222222222',
   'mailed@example.test', now() + interval '1 hour', now() + interval '1 day',
   'cancelled', 'unsubscribed', null);

-- 1. A visitor's own click, undone ---------------------------------------------
-- The argument arrives exactly as the endpoint hands it over, mixed case and
-- untrimmed, because the undo has to find the row its own unsubscribe wrote and
-- both normalise with lower + btrim, matching normalizeConsentEmail().
select is(
  public.concierge_followup_unsubscribe_undo(
    '22222222-2222-4222-8222-222222222222'::uuid, '  ViSiTor@Example.test '),
  1,
  'undoing a visitor_unsubscribe re-queues the one mail it cancelled and reports it (the address is lowercased + trimmed exactly as normalizeConsentEmail does)'
);

select is(
  (select count(*)::int from public.concierge_followup_suppressions
    where concierge_id = '22222222-2222-4222-8222-222222222222'
      and email_normalized = 'visitor@example.test'),
  0,
  'the visitor_unsubscribe suppression is removed -- this is the person''s own objection, and their own click is entitled to withdraw it'
);

select is(
  (select status || '/' || coalesce(cancel_reason, '-')
     from public.concierge_followup_outbox where id = 'aaaaaaaa-0000-4000-8000-0000000000a1'),
  'pending/-',
  'and the cancelled row goes back to pending with the reason cleared: lifting the flag without re-queueing the mail would be a button that changes nothing anybody can observe'
);

-- 2. A bounce is not a link-holder's to reverse --------------------------------
--
-- AUDITED INTERACTION, recorded here rather than fixed. resend-webhook cancels
-- through concierge_followup_unsubscribe(..., 'provider_bounce'), and that
-- function hardcodes cancel_reason = 'unsubscribed' whatever p_source says. The
-- source guard below protects the SUPPRESSION ROW only; the re-queue UPDATE is a
-- separate statement that never looks at the source, so a bounce-cancelled row
-- IS flipped back to pending by an undo. What stops the mail is not this
-- function: it is the surviving provider_bounce suppression asserted here plus
-- the all-zeros sentinel row, both of which the dispatcher re-reads immediately
-- before it transmits. Change either of the two assertions below only together
-- with that pre-send check.
select is(
  public.concierge_followup_unsubscribe_undo(
    '22222222-2222-4222-8222-222222222222'::uuid, 'bounced@example.test'),
  1,
  'the undo still reports a restored row although it removed no suppression -- the DELETE and the re-queue are independent statements and the return value counts the UPDATE'
);

select is(
  (select source from public.concierge_followup_suppressions
    where concierge_id = '22222222-2222-4222-8222-222222222222'
      and email_normalized = 'bounced@example.test'),
  'provider_bounce',
  'a provider_bounce suppression must SURVIVE the undo: the mailbox rejected us and does not exist, which is not a state the holder of a link may reverse'
);

select is(
  (select status || '/' || coalesce(cancel_reason, '-')
     from public.concierge_followup_outbox where id = 'aaaaaaaa-0000-4000-8000-0000000000b1'),
  'pending/-',
  'the bounce-cancelled row is nevertheless re-queued, because the bounce path writes cancel_reason = ''unsubscribed'' too -- the surviving suppression, re-read by the sender before every transmission, is what keeps this from becoming a mail'
);

-- 3. Nor is an operator's decision ---------------------------------------------
select is(
  public.concierge_followup_unsubscribe_undo(
    '22222222-2222-4222-8222-222222222222'::uuid, 'operator@example.test'),
  0,
  'an undo against an operator-suppressed address restores nothing -- there is no queued row, and the call is a no-op rather than an error'
);

select is(
  (select source from public.concierge_followup_suppressions
    where concierge_id = '22222222-2222-4222-8222-222222222222'
      and email_normalized = 'operator@example.test'),
  'operator',
  'an operator suppression must survive too: it is a human decision, usually the answer to a complaint, and it is removed with the SQL editor or not at all'
);

-- 4. Only rows THIS mechanism cancelled ----------------------------------------
select is(
  public.concierge_followup_unsubscribe_undo(
    '22222222-2222-4222-8222-222222222222'::uuid, 'withdrawn@example.test'),
  0,
  'a row cancelled for some other reason is not restored, so the undo reports nothing'
);

select is(
  (select status || '/' || coalesce(cancel_reason, '-')
     from public.concierge_followup_outbox where id = 'aaaaaaaa-0000-4000-8000-0000000000c1'),
  'cancelled/consent_withdrawn',
  'a mail cancelled because the consent was withdrawn stays cancelled: undoing an unsubscribe says nothing about a consent the visitor took back on the contact form'
);

-- 5. Expiry --------------------------------------------------------------------
select is(
  public.concierge_followup_unsubscribe_undo(
    '22222222-2222-4222-8222-222222222222'::uuid, 'stale@example.test'),
  0,
  'an expired row is not revived: a follow-up to a conversation from three weeks ago is not a follow-up, it is cold mail'
);

select is(
  (select status || '/' || coalesce(cancel_reason, '-')
     from public.concierge_followup_outbox where id = 'aaaaaaaa-0000-4000-8000-0000000000d1'),
  'cancelled/unsubscribed',
  'it stays cancelled with its reason intact -- the claim function would only retire it again, and refusing here means we never even hold it'
);

-- 6. One mail per mailbox, still --------------------------------------------------
select is(
  public.concierge_followup_unsubscribe_undo(
    '22222222-2222-4222-8222-222222222222'::uuid, 'mailed@example.test'),
  0,
  'nothing is re-queued for a pair that already has a sent row: the partial unique index allows one sent mail per (concierge_id, email_normalized), and reviving a pending row beside it would move that collision to send time'
);

select is(
  (select status || '/' || coalesce(cancel_reason, '-')
     from public.concierge_followup_outbox where id = 'aaaaaaaa-0000-4000-8000-0000000000f1'),
  'cancelled/unsubscribed',
  'the cancelled row beside the sent one is left exactly as it was'
);

select is(
  (select count(*)::int from public.concierge_followup_suppressions
    where concierge_id = '22222222-2222-4222-8222-222222222222'
      and email_normalized = 'mailed@example.test'),
  0,
  'the suppression is still lifted even though nothing was re-queued -- the two halves are independent, and the person''s objection is theirs to withdraw whether or not a mail comes of it'
);

-- 7. An address nobody ever suppressed --------------------------------------------
-- The endpoint reaches this whenever a second undo POST arrives, which mail
-- clients and impatient humans both produce. It must be boring.
select lives_ok(
  $$ select public.concierge_followup_unsubscribe_undo(
       '22222222-2222-4222-8222-222222222222'::uuid, 'never-heard-of@example.test') $$,
  'an undo for an address with no suppression at all must be a harmless no-op, not an error: a raise here would render the neutral page and tell a visitor their undo failed when there was nothing to undo'
);

select is(
  public.concierge_followup_unsubscribe_undo(
    '22222222-2222-4222-8222-222222222222'::uuid, 'never-heard-of@example.test'),
  0,
  'and it reports zero restored rows'
);

select * from finish();
rollback;
