-- Give every concierge a sender identity, so a follow-up mail can name a real,
-- accountable sender.
--
-- WHY THIS EXISTS
--
-- The consent chain (20260808…, supabase/functions/_shared/consent.ts) collects a
-- visitor's permission for ONE follow-up email. Permission alone does not make a
-- mail lawful to send. A commercial email must also say who is sending it, in a
-- way the recipient can act on:
--
--   * §5 DDG (the Anbieterkennzeichnung, ex-§5 TMG) -- the sender's legal name
--     and a summonable postal address have to be in the mail itself. "2Fronts"
--     is not that sender: we transmit on the coach's behalf (Art. 28 DSGVO
--     processor), the coach is the Verantwortlicher. So the coach's own block
--     has to travel with the mail, which means we have to hold it.
--   * §7 Abs. 2 Nr. 4 UWG -- the sender's identity must not be concealed, and a
--     valid address must be given at which the recipient can demand the sending
--     stops, at no cost beyond transmission. That is what followup_reply_to is:
--     a mailbox the COACH reads, not ours.
--   * Art. 13 DSGVO -- the recipient has to be able to reach the controller's
--     privacy notice. That is followup_privacy_url.
--
-- And because the coach, not 2Fronts, carries all of that, the coach has to have
-- SAID SO. followup_sender_ack_at / _version are that record: which wording they
-- accepted, and when. Like the visitor's consent, it is evidence -- so, like the
-- visitor's consent, the browser must not be able to write it.
--
-- WHY A TRIGGER AND NOT JUST RLS
--
-- "owners manage own concierges" (20260624020000) is `for all using (owner_id =
-- auth.uid())`, and 20260714000000_explicit_data_api_grants:24-27 grants UPDATE
-- on every public table to `authenticated`. RLS constrains the ROW, never the
-- COLUMN. So a signed-in coach can write ANY column of their own concierge row
-- from the browser console, including one that is meant to be our attestation
-- that they were shown the wording. Column-level protection on this table has
-- exactly one implementation here: the BEFORE UPDATE trigger from 20260727130000,
-- last redefined by 20260802090000. This migration re-creates it with three more
-- columns in its operator-owned set.

alter table concierges
  add column if not exists followup_enabled boolean not null default false,
  add column if not exists followup_reply_to text,
  add column if not exists followup_reply_to_verified_at timestamptz,
  add column if not exists followup_sender_block text,
  add column if not exists followup_privacy_url text,
  add column if not exists followup_sender_ack_at timestamptz,
  add column if not exists followup_sender_ack_version text;

comment on column concierges.followup_enabled is
  'The coach''s own off switch for follow-up mail. Deliberately client-writable: '
  'the coach must be able to stop the sending from their own dashboard, instantly '
  'and without us. NOT a permission -- true here means "I want this on", it never '
  'means "this may be sent". The send path additionally requires a confirmed '
  'visitor consent, a sender block, a privacy URL and a verified reply-to.';

comment on column concierges.followup_reply_to is
  'The mailbox the COACH reads, set as Reply-To on every follow-up. §7 Abs. 2 Nr. 4 '
  'UWG requires a valid address at which the recipient can demand the sending stops '
  'at no cost beyond transmission -- an unattended noreply@2fronts.de would not be '
  'one. Client-writable (the coach owns their own address); only its VERIFICATION '
  'is operator-owned.';

comment on column concierges.followup_reply_to_verified_at is
  'When we proved the coach actually controls followup_reply_to (round-trip token). '
  'Operator-owned: a client that could stamp this could point Reply-To at a mailbox '
  'it does not own and have 2Fronts carry the reply traffic there. NULL = unverified, '
  'which the send path must read as "do not send".';

comment on column concierges.followup_sender_block is
  'The coach''s legal name and summonable postal address, printed verbatim in the '
  'mail footer. §5 DDG (ex-§5 TMG): a commercial mail must identify its sender, and '
  'the sender is the coach (Verantwortlicher, Art. 4 Nr. 7 DSGVO) -- 2Fronts only '
  'transmits for them (Art. 28 DSGVO). Free text on purpose: address shapes differ '
  'per country and legal form, and a wrong-shaped form would produce a wrong block.';

comment on column concierges.followup_privacy_url is
  'Link to the coach''s own privacy notice, printed in the mail footer. Art. 13 DSGVO: '
  'the recipient has to be able to reach the controller''s information about the '
  'processing. Ours does not substitute for theirs -- they are the controller.';

comment on column concierges.followup_sender_ack_at is
  'When the coach accepted, in the wizard, that THEY are the legal sender of these '
  'mails and that the block above is theirs. Operator-owned evidence, written only '
  'by the concierge-setup edge function: an attestation the attesting party can '
  'forge is not an attestation. NULL = never acknowledged, so nothing may be sent.';

comment on column concierges.followup_sender_ack_version is
  'Which wording of that acknowledgement was on screen when it was given (mirrors '
  'concierge_consents.notice_version). Changing the text is a NEW version: an old row '
  'must keep proving what it was collected under, never be retro-fitted to wording '
  'the coach never read. Operator-owned for the same reason as followup_sender_ack_at.';

-- ---------------------------------------------------------------------------
-- INSERT: coerce the operator-owned columns on any client insert.
--
-- Re-created verbatim from 20260802090000 (demo live-cap on update), plus the
-- three-line block marked NEW below. Every rule that migration held -- the demo
-- coercions, the live-demo ceiling counted only for rows arriving already
-- serving, and the ordinary-account "born dormant, born unentitled" defaults --
-- is carried over unchanged.
-- ---------------------------------------------------------------------------
create or replace function force_concierge_insert_defaults() returns trigger as $$
declare
  live_demos int;
begin
  if auth.role() is distinct from 'service_role' and not is_admin() then
    -- NEW (20260809100000): a client-created concierge never arrives with the
    -- follow-up evidence already filled in. INSERT is the other door into this
    -- table -- 20260729100000 was written because the browser inserts here
    -- directly -- so an ack the UPDATE trigger refuses must not simply be
    -- shipped in the initial row instead. Coerced, not raised, so the setup
    -- wizard's insert keeps working exactly as before.
    new.followup_sender_ack_at := null;
    new.followup_sender_ack_version := null;
    new.followup_reply_to_verified_at := null;
    -- followup_enabled is NOT touched: it is the coach's switch (see the column
    -- comment), and the column default already starts it off.

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

-- ---------------------------------------------------------------------------
-- UPDATE: the column lock.
--
-- Re-created verbatim from 20260802090000, plus the guard marked NEW below. The
-- demo branch (coercions + the off->on live-demo ceiling) and the ordinary
-- branch's refusal over is_active / is_demo / demo_expires_at / entitled_until
-- are byte-for-byte what that migration installed.
--
-- WHY THE NEW GUARD SITS ABOVE THE DEMO BRANCH
--
-- A demo account is not exempt from it. The demo carve-out exists so the sales
-- console may switch its OWN demos on and off; it says nothing about who may
-- mint follow-up evidence, and a demo account has even less business doing so
-- than a paying coach. Checking before the branch also means neither branch can
-- drift away from it later.
-- ---------------------------------------------------------------------------
create or replace function prevent_concierge_activation_client_write() returns trigger as $$
declare
  live_demos int;
begin
  if auth.role() is distinct from 'service_role' and not is_admin() then
    -- NEW (20260809100000): the follow-up sender EVIDENCE columns. These record
    -- what we attest about the coach (they accepted the sender wording; we
    -- verified their reply-to). A party that can write its own attestation has
    -- not attested to anything, so the browser is refused here and the
    -- concierge-setup edge function writes them with the service role.
    if (new.followup_sender_ack_at is distinct from old.followup_sender_ack_at
        or new.followup_sender_ack_version is distinct from old.followup_sender_ack_version
        or new.followup_reply_to_verified_at is distinct from old.followup_reply_to_verified_at) then
      raise exception
        'followup_sender_ack_at, followup_sender_ack_version and followup_reply_to_verified_at may only be written by the service role or an admin';
    end if;

    -- DELIBERATELY NOT IN THAT SET: followup_enabled.
    --
    -- It is the coach's kill switch. If a later "tightening" moves it up here,
    -- the coach can no longer switch their own follow-up mail off from their
    -- dashboard -- they would have to ask us, by email, and wait. That is the
    -- opposite of the control this whole feature is built to demonstrate, and
    -- it would be the one failure mode that turns a missing feature into an
    -- unlawful send. Locking it protects nobody: turning the flag ON grants no
    -- permission by itself (the send path also demands a confirmed visitor
    -- consent, an ack, and a verified reply-to), and turning it OFF is a right,
    -- not a privilege. Leave it writable.
    --
    -- followup_reply_to / _sender_block / _privacy_url are likewise the coach's
    -- own data to correct at any time; only our attestations about them are
    -- locked above.

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

-- No GRANT or RLS change: new columns on an existing table inherit the table's
-- privileges, and "owners manage own concierges" already scopes every write to
-- the owner's own rows. The column-level protection is the trigger above --
-- which is the entire point of the header note about RLS and columns.
