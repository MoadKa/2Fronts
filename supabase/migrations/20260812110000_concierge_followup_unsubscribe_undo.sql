-- concierge_followup_unsubscribe_undo: the way back out of an unsubscribe
-- nobody asked for.
--
-- WHY THIS EXISTS AT ALL.
--
-- concierge-followup-unsubscribe acts on a bare GET, with no confirmation
-- click. That is deliberate and it is the right trade: Outlook Safe Links,
-- Proofpoint and Mimecast fetch every URL in an inbound mail, and the misfire
-- direction here is "a mail is not sent", which harms nobody's rights. Making a
-- person click twice to escape a mailing would trade a §7 UWG exposure for a
-- commercial convenience, in the wrong order.
--
-- But it does mean a scanner can retire a follow-up the recipient was happy to
-- receive, silently, before they ever opened the mail. This function is the
-- price paid for that choice: the endpoint's POST ?undo=1 route calls it, and
-- the coach gets their lead back.
--
-- IT IS AN RPC, NOT A DELETE THROUGH PostgREST, and that is a security
-- requirement, not a preference. The deletion is keyed on an e-mail address.
-- isEmail() in concierge-chat accepts `,`, `(` and `)`, all of which are
-- PostgREST filter syntax, so an address dropped into a filter string is a
-- crafted address that deletes OTHER people's suppressions. Here the address
-- arrives as a bound argument and never becomes syntax. Same argument section 6
-- of 20260812100000 makes for the batch suppression check.
--
-- ONLY A VISITOR'S OWN CLICK CAN BE UNDONE.
--
-- The delete is restricted to source = 'visitor_unsubscribe'. A
-- 'provider_bounce' means the mailbox rejected us and does not exist; an
-- 'operator' row is a human decision, usually the answer to a complaint.
-- Neither is a state the holder of a link is entitled to reverse, and a URL that
-- could reverse them would be a way to re-enable mail to an address that was
-- suppressed for reasons its owner does not control. Those two are removed by a
-- human with the SQL editor or not at all.
--
-- POST-ONLY, ENFORCED IN THE EDGE FUNCTION. This is the one direction where a
-- prefetch would be dangerous: mail somebody stopped would start again. The
-- endpoint therefore refuses to reach this function on GET or HEAD, whatever
-- the query string says.

-- Roll back with:
--   drop function if exists public.concierge_followup_unsubscribe_undo(uuid, text);

create or replace function public.concierge_followup_unsubscribe_undo(
  p_concierge_id uuid,
  p_email text
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- lower + trim, matching normalizeConsentEmail() in
  -- supabase/functions/_shared/consent.ts and the sibling function in
  -- 20260812100000. All three move together or an undo stops finding the row
  -- its own unsubscribe wrote.
  v_norm text := lower(btrim(coalesce(p_email, '')));
  v_restored int;
begin
  if p_concierge_id is null or v_norm = '' then
    raise exception
      'concierge_followup_unsubscribe_undo needs a concierge_id and a non-empty e-mail address';
  end if;

  delete from public.concierge_followup_suppressions s
   where s.concierge_id = p_concierge_id
     and s.email_normalized = v_norm
     -- See the header. A bounce or an operator decision is not undoable here.
     and s.source = 'visitor_unsubscribe';

  -- Removing the do-not-send flag is not enough on its own: the unsubscribe
  -- also cancelled the queued mail, and an undo that left it cancelled would be
  -- a button that changes nothing anybody can observe.
  --
  -- Three guards, and each one is load-bearing:
  --
  --   cancel_reason = 'unsubscribed' -- only rows THIS mechanism cancelled. A
  --     row cancelled because the coach turned follow-up off, or because the
  --     consent was withdrawn on the contact form, stays cancelled.
  --   expires_at > now() -- a follow-up to a conversation from three weeks ago
  --     is not a follow-up, it is cold mail. The claim function retires expired
  --     rows anyway; refusing to revive them here means we never even hold one.
  --   no 'sent' row for this pair -- the partial unique index in 20260812100000
  --     allows one sent mail per (concierge_id, email_normalized). Reviving a
  --     pending row alongside a sent one would move that collision to send time,
  --     where it becomes a failed send instead of a no-op here.
  update public.concierge_followup_outbox o
     set status = 'pending',
         cancel_reason = null
   where o.concierge_id = p_concierge_id
     and o.email_normalized = v_norm
     and o.status = 'cancelled'
     and o.cancel_reason = 'unsubscribed'
     and o.expires_at > now()
     and not exists (
       select 1
         from public.concierge_followup_outbox sent
        where sent.concierge_id = p_concierge_id
          and sent.email_normalized = v_norm
          and sent.status = 'sent'
     );

  get diagnostics v_restored = row_count;
  return v_restored;
end;
$$;

comment on function public.concierge_followup_unsubscribe_undo(uuid, text) is
  'Reverses a visitor_unsubscribe: drops the suppression and re-queues the mail '
  'it cancelled, if that mail has not expired and none was ever sent. Never '
  'touches provider_bounce or operator suppressions. Called only by '
  'concierge-followup-unsubscribe on POST ?undo=1 -- never on GET, because a '
  'mail-client prefetch must not be able to restart a mailing.';

-- Privileges. Postgres auto-grants EXECUTE to PUBLIC at creation time and
-- anon/authenticated inherit through PUBLIC, so this revoke is the whole gate:
-- the function is SECURITY DEFINER and bypasses the table privileges and the
-- zero-policy RLS on concierge_followup_suppressions entirely. An
-- anon-executable version would let any script on the internet delete anybody's
-- objection and re-queue mail to them, which is a worse endpoint than the
-- unsubscribe one it undoes. Same treatment 20260812100000 gives its three.
revoke execute on function public.concierge_followup_unsubscribe_undo(uuid, text) from public;
grant execute on function public.concierge_followup_unsubscribe_undo(uuid, text) to service_role;
