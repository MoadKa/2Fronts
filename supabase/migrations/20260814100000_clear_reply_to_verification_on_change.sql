-- A reply-to verification must never survive the address it verified.
--
-- WHY THIS EXISTS
--
-- 20260809100000 locked followup_reply_to_verified_at against client writes: it
-- is OUR attestation that we proved the coach reads that mailbox, and a party
-- that can write its own attestation has not attested to anything. It
-- deliberately left followup_reply_to itself CLIENT-WRITABLE, because the
-- address is the coach's own data and they must be able to correct it from
-- their dashboard without asking us.
--
-- Those two decisions leave a hole between them. A signed-in coach can change
-- followup_reply_to from the browser -- RLS constrains the row, never the
-- column -- while the stamp we wrote about the OLD address stays put. The send
-- path (concierge-followup-send/decide.ts) then reads a verified reply-to that
-- was never verified, and every follow-up mail sent in that coach's name would
-- carry Reply-To pointing at a mailbox nobody proved they control. That is
-- exactly the harm the column comment names: "a client that could stamp this
-- could point Reply-To at a mailbox it does not own and have 2Fronts carry the
-- reply traffic there". Locking the stamp and leaving the address open is the
-- same hole reached in two steps instead of one.
--
-- concierge-setup already clears the stamp when the WIZARD saves a different
-- address, but that path runs with the service role, which this trigger
-- exempts, and it is not the only door: the browser can UPDATE the row
-- directly. Both halves are needed, and neither is redundant.
--
-- COERCED, NOT RAISED. Refusing the update would take away the coach's ability
-- to fix a typo in their own address, which is a right, not a privilege. The
-- cost of a change is a new verification mail, not a support ticket.
--
-- Re-created verbatim from 20260809100000 plus the block marked NEW. Every rule
-- that migration held -- the follow-up evidence guard, the demo coercions, the
-- off->on live-demo ceiling, and the ordinary branch's refusal over is_active /
-- is_demo / demo_expires_at / entitled_until -- is carried over unchanged.
--
-- ORDER MATTERS INSIDE THE FUNCTION. The new block sits AFTER the guard that
-- raises when a client touches followup_reply_to_verified_at. A client changing
-- their address sends the stamp unchanged, so the guard passes and the
-- coercion then clears it; a client trying to change BOTH still hits the raise,
-- which is the answer that belongs to that attempt. Putting the coercion above
-- the guard would make every honest address change raise an exception instead.

create or replace function prevent_concierge_activation_client_write() returns trigger as $$
declare
  live_demos int;
begin
  if auth.role() is distinct from 'service_role' and not is_admin() then
    -- 20260809100000: the follow-up sender EVIDENCE columns. These record what
    -- we attest about the coach (they accepted the sender wording; we verified
    -- their reply-to). A party that can write its own attestation has not
    -- attested to anything, so the browser is refused here and the
    -- concierge-setup edge function writes them with the service role.
    if (new.followup_sender_ack_at is distinct from old.followup_sender_ack_at
        or new.followup_sender_ack_version is distinct from old.followup_sender_ack_version
        or new.followup_reply_to_verified_at is distinct from old.followup_reply_to_verified_at) then
      raise exception
        'followup_sender_ack_at, followup_sender_ack_version and followup_reply_to_verified_at may only be written by the service role or an admin';
    end if;

    -- NEW (20260814100000): changing the address drops the verification of it.
    --
    -- Compared as stored, not normalised: a change of case or spacing clears the
    -- stamp too. That is the safe direction (one extra verification mail), and
    -- the alternative would put an address-normalisation rule into a trigger
    -- where nobody would think to look for it.
    if new.followup_reply_to is distinct from old.followup_reply_to then
      new.followup_reply_to_verified_at := null;
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
    -- locked above, and the one attestation that is ABOUT the address now
    -- falls with it.

    if is_demo_account() then
      new.is_demo := true;
      new.entitled_until := null;
      new.demo_expires_at := least(
        coalesce(new.demo_expires_at, old.demo_expires_at, now() + demo_max_lifetime()),
        now() + demo_max_lifetime()
      );

      -- Charged only on the off -> on transition, so retiring is always allowed
      -- and an ordinary edit to an already-live demo never trips the ceiling.
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

-- No trigger re-creation: concierges_lock_activation (20260727130000) already
-- points at this function, and CREATE OR REPLACE keeps that binding.
