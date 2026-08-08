begin;
select plan(17);

-- The follow-up sender identity (20260809100000).
--
-- Two properties are under test, and they pull in opposite directions on purpose:
--
--   * the EVIDENCE columns (followup_sender_ack_at, followup_sender_ack_version,
--     followup_reply_to_verified_at) are ours. A coach who could stamp their own
--     acknowledgement from the browser console would leave us holding an
--     attestation the attesting party wrote -- worth nothing at the moment an
--     Abmahnung asks for it. RLS cannot express that: "owners manage own
--     concierges" scopes the ROW, and 20260714000000 grants `authenticated`
--     UPDATE on every column of it. Only the BEFORE UPDATE trigger can.
--
--   * followup_enabled is the coach's. It must stay writable from their own
--     dashboard, because it is their off switch. A future "tightening" that
--     sweeps it into the locked set would lock a coach out of stopping their own
--     mail, and this test is the tripwire that fails when someone tries.
--
-- Roles are impersonated the way the rest of this schema expects: auth.role()
-- reads the JWT claim, NOT the Postgres role, so `set local role service_role`
-- alone would still be refused. Both have to be set.

select has_column('public', 'concierges', 'followup_enabled', 'concierges should have followup_enabled');
select has_column('public', 'concierges', 'followup_reply_to', 'concierges should have followup_reply_to');
select has_column('public', 'concierges', 'followup_reply_to_verified_at', 'concierges should have followup_reply_to_verified_at');
select has_column('public', 'concierges', 'followup_sender_block', 'concierges should have followup_sender_block');
select has_column('public', 'concierges', 'followup_privacy_url', 'concierges should have followup_privacy_url');
select has_column('public', 'concierges', 'followup_sender_ack_at', 'concierges should have followup_sender_ack_at');
select has_column('public', 'concierges', 'followup_sender_ack_version', 'concierges should have followup_sender_ack_version');

-- Fixture: one coach, one concierge they own. Inserted as the session user, so
-- the row exists before any role is impersonated. The insert trigger coerces it
-- dormant, which is exactly what a real wizard insert produces.
insert into auth.users (id, email)
  values ('11111111-1111-1111-1111-111111111111', 'followup-sender-test@example.com');

insert into concierges (id, owner_id, slug, business_name, offer_description, calendar_url)
  values (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'followup-sender-test',
    'Followup Sender Test',
    'We coach founders.',
    'https://cal.com/followup-sender-test'
  );

-- ---------------------------------------------------------------------------
-- As the coach's own browser session.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}';

select throws_ok(
  $$ update public.concierges set followup_sender_ack_at = now()
      where id = '22222222-2222-2222-2222-222222222222' $$,
  'P0001',
  null,
  'authenticated writing followup_sender_ack_at should raise (the ack is ours, not the coach''s)'
);

select throws_ok(
  $$ update public.concierges set followup_sender_ack_version = 'forged-v99'
      where id = '22222222-2222-2222-2222-222222222222' $$,
  'P0001',
  null,
  'authenticated writing followup_sender_ack_version should raise'
);

select throws_ok(
  $$ update public.concierges set followup_reply_to_verified_at = now()
      where id = '22222222-2222-2222-2222-222222222222' $$,
  'P0001',
  null,
  'authenticated writing followup_reply_to_verified_at should raise (we verify, they do not)'
);

-- The off switch. This one MUST work from the browser.
select lives_ok(
  $$ update public.concierges set followup_enabled = true
      where id = '22222222-2222-2222-2222-222222222222' $$,
  'authenticated should be able to flip followup_enabled (it is the coach''s own kill switch)'
);

select is(
  (select followup_enabled from public.concierges where id = '22222222-2222-2222-2222-222222222222'),
  true,
  'the coach''s followup_enabled write should actually land, not be silently reverted'
);

-- Their own contact details are theirs to correct at any time; only our
-- attestations ABOUT them are locked.
select lives_ok(
  $$ update public.concierges
        set followup_sender_block = 'Acme Coaching GmbH, Musterstr. 1, 45127 Essen',
            followup_privacy_url = 'https://acme.de/datenschutz',
            followup_reply_to = 'hallo@acme.de'
      where id = '22222222-2222-2222-2222-222222222222' $$,
  'authenticated should be able to write their own sender block, privacy URL and reply-to'
);

reset role;

-- ---------------------------------------------------------------------------
-- As the edge function (service role). auth.role() reads the JWT claim, so the
-- claim is what actually opens the lock; the Postgres role is set too because
-- that is how the function really connects.
-- ---------------------------------------------------------------------------
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select lives_ok(
  $$ update public.concierges
        set followup_sender_ack_at = now(),
            followup_sender_ack_version = 'concierge-followup-sender-v1'
      where id = '22222222-2222-2222-2222-222222222222' $$,
  'service_role should be able to stamp the sender acknowledgement'
);

select is(
  (select followup_sender_ack_version from public.concierges
     where id = '22222222-2222-2222-2222-222222222222'),
  'concierge-followup-sender-v1',
  'the service-role ack version should land'
);

select lives_ok(
  $$ update public.concierges set followup_reply_to_verified_at = now()
      where id = '22222222-2222-2222-2222-222222222222' $$,
  'service_role should be able to record the reply-to verification'
);

select isnt(
  (select followup_reply_to_verified_at from public.concierges
     where id = '22222222-2222-2222-2222-222222222222'),
  null,
  'the service-role reply-to verification timestamp should land'
);

reset role;

select * from finish();
rollback;
