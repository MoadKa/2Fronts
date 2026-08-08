-- Record the moment the setter TOLD a visitor that an email was coming.
--
-- WHY THIS COLUMN EXISTS
--
-- Step 21 lets the concierge mention the follow-up, but only against a grant
-- (supabase/functions/_shared/followUpGrant.ts) that is issued exactly when the
-- dispatcher would really send. That handles the promise. It does not handle the
-- promise being REVOKED.
--
-- The failure it fixes is specific. A visitor confirms their consent, the bot
-- says "you'll get an email about this", and then the visitor withdraws --
-- unticks the box on a resubmit, or clicks unsubscribe in the confirmation mail.
-- From that second on, decide.ts cancels the queued row with consent_withdrawn:
-- no mail will ever be sent. But the conversation carries on, and the model's
-- own earlier sentence is still sitting in the history it re-reads on every
-- turn. A model that reads its own promise keeps the story going. The visitor is
-- left waiting for a message that was killed, and the last thing they were told
-- about it was a lie told in the coach's name.
--
-- Withholding the correction is not neutral. Saying nothing reads, to the person
-- who was promised a mail, as "it is still coming". So the prompt needs a third
-- state -- prohibition PLUS an explicit instruction to take the promise back --
-- and that state is only reachable if we know a promise was ever made.
--
-- WHY IT IS A TIMESTAMP AND NOT A BOOLEAN
--
-- The same reason concierge_consents stores created_at rather than a flag: this
-- is a record of something said to a person at a moment, in their coach's name,
-- and "when" is half of what makes it answerable later. A boolean can say a
-- promise happened; only a timestamp can be compared against the withdrawal that
-- invalidated it, or against the send that kept it.
--
-- WHY IT LIVES ON THE CONVERSATION
--
-- The promise is scoped to one chat: a visitor who returns in a new browser
-- session (conversations are keyed (concierge_id, visitor_session_id),
-- 20260625120000) starts a conversation whose history contains no promise, so
-- there is nothing there to correct. Putting it on the conversation makes the
-- column mean exactly what the model can see.
--
-- NULL = the setter has never promised this visitor anything, which is every row
-- that exists today and every conversation where the grant was withheld. The
-- prompt's default state is the flat prohibition, so a NULL here changes nothing.
--
-- No transaction wrapper: the Supabase CLI owns the transaction for a migration
-- file and a nested begin;/commit; breaks it. This project has been burned by
-- that before.
--
-- ROLLBACK
--
--   alter table public.concierge_conversations drop column if exists followup_promised_at;
--
-- Safe to drop: nothing reads it except the prompt builder, which treats absent
-- as "never promised" and falls back to the prohibition -- i.e. to the behaviour
-- that shipped before any of this existed.

alter table public.concierge_conversations
  add column if not exists followup_promised_at timestamptz;

comment on column public.concierge_conversations.followup_promised_at is
  'When the setter first told THIS visitor, in THIS conversation, that a follow-up '
  'email was coming. Written only by the concierge-chat edge function, and only on '
  'the turn where a FollowUpGrant was in hand. NULL = never promised, which is the '
  'default and keeps the prompt on its flat no-promise rule. Read back on later '
  'turns so that a consent withdrawn AFTER a promise produces an explicit '
  'correction instead of a silence the visitor reads as "still coming".';


-- Privileges -----------------------------------------------------------------
--
-- Stated explicitly rather than left to inheritance, the posture
-- 20260812100000 section 7 takes: a REVOKE or GRANT that is silently a no-op is
-- still a written statement of what we intend, and the alternative is a column
-- whose access story lives nowhere.
--
-- 20260714000000_explicit_data_api_grants.sql grants SELECT/INSERT/UPDATE/DELETE
-- on every public table to anon and authenticated, and a new column on an
-- existing table inherits the TABLE-level grant automatically. Postgres has no
-- way to subtract a single column from a table-wide grant -- a column-level
-- REVOKE against a table-level GRANT is a no-op, not a carve-out -- so this file
-- deliberately does not pretend to fence the column off at the privilege layer.
--
-- What actually scopes it is RLS, which was already enabled on this table in
-- 20260624020000 and carries exactly two policies: "admins manage concierge
-- conversations" and "owners read own concierge conversations" (20260626120000).
-- anon holds the grant and matches no policy, so it reads nothing. A signed-in
-- coach can read this column on their OWN conversations, and that is correct and
-- intended: it is a record of what their own setter said in their own name, on
-- their own page. There is nothing here they should not see.
--
-- WRITES are the part that matters, and they are not fenced by RLS either --
-- "owners read own" is SELECT-only, so a coach cannot UPDATE these rows at all,
-- which is the existing behaviour for every other column on this table
-- (visitor_email, phase, qualification_answers) and needs no new rule.
grant select (followup_promised_at), update (followup_promised_at)
  on table public.concierge_conversations to service_role;

-- No index. The column is only ever read on a row already fetched by primary key
-- for the current turn, never searched or aggregated, so an index would cost
-- write time on every conversation and buy nothing.
