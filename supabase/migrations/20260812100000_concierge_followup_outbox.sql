-- The follow-up send queue: one durable row per mail we intend to send, one
-- global stop switch, and one list of people who have said no.
--
-- WHERE THIS SITS
--
--   20260808120000_concierge_consent.sql   -- may we send at all (§7 Abs. 2 UWG)
--   20260809100000_concierge_followup_sender.sql -- who is the sender (§5 DDG)
--   THIS FILE                              -- what is actually queued, and once
--
-- Consent and sender identity make a mail lawful. They do not make it SENT, and
-- they do not stop it being sent twice. An edge isolate can die between "I read
-- the consent" and "the provider accepted the message", and the visitor is
-- promised, in the notice wording they ticked, "eine einzige E-Mail" / "a single
-- email". That promise is a schema problem, not an application problem: it has
-- to survive a crashed isolate, a retry, a duplicated queue message and a coach
-- with two browser tabs. So the queue lives here, with the once-ness expressed
-- as a unique index rather than as a code path.
--
-- No transaction wrapper: the Supabase CLI owns the transaction for a migration
-- file, and a nested begin;/commit; breaks it. This project has been burned by
-- that before.
--
-- ROLLBACK
--
--   drop function if exists public.concierge_followup_unsubscribe(uuid, text, text);
--   drop function if exists public.concierge_followup_suppressed(jsonb);
--   drop function if exists public.concierge_followup_claim(int, timestamptz);
--   drop table if exists public.concierge_followup_ops;
--   drop table if exists public.concierge_followup_suppressions;
--   drop table if exists public.concierge_followup_outbox;
--
-- Dropping the outbox destroys the record of which mails went out, which is the
-- only thing that can answer "did we mail this person already". Take a copy
-- first; there is no other source for it.


-- 1. The outbox ---------------------------------------------------------------
--
-- !! DO NOT ADD `REFERENCES` TO concierge_id, conversation_id OR consent_id !!
--
-- Same reasoning as concierge_consents (see the long note at the top of
-- 20260808120000), and it lands even harder here because this table records
-- something that already happened in the outside world:
--
--   * ON DELETE CASCADE from concierges would erase the record of a mail we
--     really did send, at the exact moment a coach deletes their setter. That is
--     also the moment a complaint is most likely to arrive about it.
--     20260729100000's header documents delete-and-reinsert as ordinary,
--     observed coach behaviour -- not an edge case.
--   * conversation_id would cascade twice over: concierge_conversations already
--     cascades from concierges (20260624020000), so one deleted setter would
--     take the send history with it through two separate paths.
--   * consent_id points into an APPEND-ONLY ledger with a 3-year retention
--     purge. CASCADE would delete the send record when the consent is purged;
--     RESTRICT would make the purge impossible; SET NULL is an UPDATE on this
--     row, which is harmless here but silently detaches evidence from the mail
--     it justified. None of the three is the behaviour we want, which is: the
--     pointer keeps its value and stops resolving.
--
-- Referential drift is accepted and intended. The evidence snapshot columns at
-- the bottom exist precisely so a row still means something after everything it
-- points at is gone.
create table if not exists public.concierge_followup_outbox (
  id uuid primary key default gen_random_uuid(),

  -- Who is sending. See the FK warning above: no references.
  concierge_id uuid not null,

  -- Which chat produced this. UNIQUE, so the same conversation can never enqueue
  -- twice -- but read the partial index in section 4 before believing that alone
  -- delivers "one mail per person". It does not.
  conversation_id uuid unique,

  -- The recipient, lowercased + trimmed exactly as normalizeConsentEmail() does
  -- (lower + trim only; no dot- or plus-stripping, those are Gmail conventions
  -- and folding a+b@x.de into a@x.de would mail the wrong mailbox).
  --
  -- DENORMALISED ON PURPOSE, and it is load-bearing. Both the batch suppression
  -- check and the unsubscribe cancel are keyed on (concierge_id, address). If
  -- the address only existed on concierge_consents, every one of those lookups
  -- would have to travel through PostgREST as a join or an embedded filter, and
  -- neither is expressible (see section 6 for what that would force us to build
  -- instead, and why it would be a filter-injection hole). It also keeps working
  -- after the consent row is purged at three years.
  email_normalized text not null,

  -- The concierge_consents row with action = 'confirmed' that authorises this
  -- send -- the only state maySendFollowup() accepts. Nullable: a row can outlive
  -- the ledger entry (3-year purge) and an operator-enqueued row may predate one.
  -- A NULL here is NOT permission; the sender re-derives consent state before it
  -- transmits, every time.
  consent_id uuid,

  -- When it may first go out, and when it stops being worth sending. A follow-up
  -- to a conversation from three weeks ago is not a follow-up, it is cold mail --
  -- and cold mail is the thing §7 Abs. 2 UWG forbids. So expiry is enforced, not
  -- advisory: the claim function in section 5 retires expired rows.
  scheduled_at timestamptz not null,
  expires_at timestamptz not null,

  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),

  -- attempts: HARD tries. Incremented on every claim, and the claim function
  -- retires a row once it reaches the ceiling (3, see section 5).
  -- soft_retries: provider back-pressure -- a 429 or a 5xx that we chose to try
  -- again later without burning an attempt. Kept separate so a provider having a
  -- bad afternoon cannot silently consume a visitor's only mail.
  attempts int not null default 0,
  soft_retries int not null default 0,

  claimed_at timestamptz,
  sent_at timestamptz,

  -- The provider's own id for the message, so a bounce or complaint webhook can
  -- be matched back to the row that caused it.
  provider_id text,

  cancel_reason text,
  last_error text,

  -- EVIDENCE SNAPSHOT -- what we actually transmitted, frozen at send time.
  --
  -- Same argument as concierge_consents: a pointer to "the current template" and
  -- "the current consent wording" proves nothing about what this recipient
  -- received. §7 Abs. 2 UWG asks the sender to show consent for THIS mail, and
  -- Art. 5 Abs. 2 DSGVO asks them to be able to demonstrate it. Both questions
  -- are about a moment in the past, so the answer has to be stored in the past
  -- tense. These four columns are the only thing that can answer them once the
  -- template has moved on.
  sent_subject text,
  sent_body text,
  sent_consent_text text,
  sent_consent_confirmed_at timestamptz,

  created_at timestamptz not null default now()
);

comment on table public.concierge_followup_outbox is
  'Durable send queue for follow-up mail: one row per intended message. Holds no '
  'foreign keys by design (see the file header) and freezes what was actually '
  'sent in the sent_* columns. The once-per-recipient promise made in the consent '
  'notice is enforced by the partial unique index on (concierge_id, '
  'email_normalized) where status = ''sent'', NOT by the unique conversation_id.';

create index if not exists concierge_followup_outbox_due_idx
  on public.concierge_followup_outbox (status, scheduled_at)
  where status in ('pending', 'sending');

-- The unsubscribe cancel and the "have we mailed this person" question both look
-- rows up by (concierge_id, email_normalized) across ALL statuses, which the
-- partial unique index below cannot serve.
create index if not exists concierge_followup_outbox_recipient_idx
  on public.concierge_followup_outbox (concierge_id, email_normalized);


-- 2. Suppressions -------------------------------------------------------------
--
-- "This address has told this sender to stop." Deliberately SEPARATE from the
-- consent ledger: a withdrawal there is evidence about a consent, this is an
-- operational do-not-send list, and the send path must be able to answer it in
-- one indexed lookup without deriving state from an append-only history.
--
-- !! NO CASCADE FROM concierges, AND NO FOREIGN KEY AT ALL !!
--
-- 20260729100000's header records delete-and-reinsert as observed coach
-- behaviour: a coach deletes their setter and creates a new one, same slug, to
-- get back to a default they liked. If this table cascaded, that ordinary act
-- would delete the record of an objection along with the sender row -- and the
-- next enqueue for that address, under the new concierge_id, would find nothing
-- and send. The person who unsubscribed would be mailed again by the same coach,
-- which is precisely the §7 Abs. 2 Nr. 4 UWG failure the unsubscribe link exists
-- to prevent. A stale row pointing at a deleted concierge costs nothing; a
-- deleted row costs an Abmahnung.
create table if not exists public.concierge_followup_suppressions (
  concierge_id uuid not null,
  email_normalized text not null,
  -- Kept in step with the ConsentSource union in
  -- supabase/functions/_shared/consent.ts, restricted to the three sources that
  -- can produce a suppression. The contact-form sources cannot: an
  -- unauthenticated form has not proven control of the mailbox (see
  -- prior_conversation_id's note in consent.ts).
  source text not null
    check (source in ('visitor_unsubscribe', 'provider_bounce', 'operator')),
  created_at timestamptz not null default now(),
  primary key (concierge_id, email_normalized)
);

comment on table public.concierge_followup_suppressions is
  'Do-not-send list, keyed (concierge_id, email_normalized). Survives deletion of '
  'the concierge on purpose -- no foreign key, no cascade -- because a coach '
  'deleting and re-creating their setter must not erase somebody''s objection. '
  'First source wins: the insert is ON CONFLICT DO NOTHING, so the record keeps '
  'saying how we first learned they wanted out.';


-- 3. The stop switch ----------------------------------------------------------
--
-- One row, forever. Flipping sending_enabled to false stops every claim
-- immediately, from the SQL editor, with no deploy, no redeploy of an edge
-- function and no environment variable. That matters because the failure mode
-- this feature can produce is mail already leaving the building: an env var
-- needs a deploy to take effect, and a deploy is minutes we would not have.
--
-- It ships FALSE. The queue fills up from the day this lands and sends nothing
-- until a human turns it on, which is the correct default for a system whose
-- worst bug is "sent something it should not have".
create table if not exists public.concierge_followup_ops (
  id int primary key default 1 check (id = 1),
  sending_enabled boolean not null default false,
  -- Why it is off. Read by whoever finds it off at 3am and has to decide whether
  -- turning it back on is safe.
  note text,
  updated_at timestamptz not null default now()
);

insert into public.concierge_followup_ops (id, sending_enabled, note)
  values (1, false, 'ships off: enable only after the sender path has been verified end to end')
  on conflict (id) do nothing;

comment on table public.concierge_followup_ops is
  'Single-row global kill switch for follow-up sending (id = 1, enforced by a '
  'check constraint). concierge_followup_claim() returns nothing while '
  'sending_enabled is false, so one UPDATE stops the whole pipeline without a '
  'deploy. Ships false.';


-- 4. Once ---------------------------------------------------------------------
--
-- THIS is what makes "eine einzige E-Mail" true, and `unique (conversation_id)`
-- above is NOT.
--
-- Conversations are keyed (concierge_id, visitor_session_id)
-- (20260625120000_concierge_conversation_unique.sql), and visitor_session_id is
-- generated in the browser and stored there. So it is per-browser, per-profile
-- and per-storage-clear. One person with the coach's page open in two tabs, or
-- who comes back on their phone, or who clears site data, is TWO conversations
-- with two session ids and one mailbox. Unique-per-conversation would happily
-- send them two mails, each individually "correct".
--
-- The promise the visitor read is about their inbox, so the constraint has to be
-- about their inbox too. Partial on status = 'sent' because pending, failed and
-- cancelled rows must be allowed to coexist for the same recipient -- a failed
-- attempt has to be re-enqueueable, and a cancelled one has to stay on the
-- record. Only actually-sent counts.
--
-- Consequence, stated so nobody treats it as a bug: once a mail is sent to an
-- address, no second one can ever be queued-and-sent for that sender, including
-- for a genuinely new conversation months later. That is the promise, literally.
-- Widening this needs new consent wording first, not a new index.
create unique index if not exists concierge_followup_outbox_one_sent_per_recipient_idx
  on public.concierge_followup_outbox (concierge_id, email_normalized)
  where status = 'sent';


-- 5. Claiming -----------------------------------------------------------------
--
-- Same shape as concierge_rate_limit_hit (20260625130000): the workers are
-- stateless edge isolates, so the coordination lives in Postgres and is done
-- atomically inside one SECURITY DEFINER function the service role calls.
--
-- p_now is the comparison clock. Production passes nothing and gets now() from
-- the database; the parameter exists so tests and a replay tool can pin time. It
-- is deliberately NOT written into any of the sent_* evidence columns -- those
-- are stamped by the sender at the moment of the send, from the database clock,
-- for the reason buildConsentRow() gives for producing no created_at.
--
-- THE RETIREMENT BRANCH IS NOT AN OPTIMISATION. Without it a row whose isolate
-- died on its LAST allowed attempt is stranded forever: it sits at
-- status = 'sending' with attempts at the ceiling, so it matches neither the
-- pending predicate nor -- once it has been refused for exhausted attempts --
-- anything that would ever change it again. It stays inside the queue's working
-- set, is counted by every "how deep is the backlog" query, and is invisible to
-- the operator because nothing ever reports it. So the same statement that
-- claims work also retires the rows that can no longer be worked.
--
-- The two data-modifying CTEs have MUTUALLY EXCLUSIVE predicates on purpose.
-- Postgres does not support updating the same row twice in one statement: one of
-- the two updates would simply not happen, and which one is not defined. `retire`
-- takes exhausted-or-expired, `claim` takes the strict complement.
create or replace function public.concierge_followup_claim(
  p_limit int,
  p_now timestamptz default now()
) returns setof public.concierge_followup_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Three hard attempts. A fourth would not fix a permanently rejecting address
  -- and each one is a real delivery attempt against a real mailbox.
  v_max_attempts constant int := 3;
  -- How long a 'sending' row may stay claimed before we assume its isolate is
  -- gone. Comfortably longer than an edge function's wall-clock ceiling, so a
  -- slow-but-alive send is never claimed a second time.
  v_stale constant interval := interval '5 minutes';
  v_enabled boolean;
begin
  -- The stop switch, checked first so flipping it costs one UPDATE and takes
  -- effect on the very next claim. Missing row = disabled: fail closed.
  select o.sending_enabled into v_enabled
    from public.concierge_followup_ops o where o.id = 1;
  if coalesce(v_enabled, false) is not true then
    return;
  end if;

  return query
  with candidate as (
    select o.id, o.attempts, o.expires_at
      from public.concierge_followup_outbox o
     where (
             -- Due, or already dead on arrival (expires_at can precede
             -- scheduled_at if it was enqueued wrong; that row still has to be
             -- retired rather than left pending forever).
             o.status = 'pending'
             and (o.scheduled_at <= p_now or o.expires_at <= p_now)
           )
        or (
             -- Abandoned by a dead isolate.
             o.status = 'sending'
             and o.claimed_at is not null
             and o.claimed_at < p_now - v_stale
           )
     order by o.scheduled_at
     limit greatest(coalesce(p_limit, 0), 0)
     -- skip locked is what lets two workers run at once: a row another
     -- transaction is already holding is passed over rather than waited on, so
     -- concurrent claims return disjoint sets instead of serialising.
     for update skip locked
  ),
  retire as (
    update public.concierge_followup_outbox o
       set status = case when c.attempts >= v_max_attempts then 'failed'
                         else 'cancelled' end,
           cancel_reason = case when c.attempts >= v_max_attempts then o.cancel_reason
                                else 'expired' end,
           last_error = case
             when c.attempts >= v_max_attempts
               then coalesce(o.last_error, 'retired: attempts exhausted with no result')
             else o.last_error
           end
      from candidate c
     where o.id = c.id
       and (c.attempts >= v_max_attempts or c.expires_at <= p_now)
    returning o.id
  ),
  claimed as (
    update public.concierge_followup_outbox o
       set status = 'sending',
           claimed_at = p_now,
           attempts = o.attempts + 1
      from candidate c
     where o.id = c.id
       and c.attempts < v_max_attempts
       and c.expires_at > p_now
    returning o.*
  )
  select claimed.* from claimed;

  -- `retire` is never referenced by the final select. It still runs: Postgres
  -- executes every data-modifying CTE exactly once per statement, referenced or
  -- not. Do not "tidy" it into a separate statement -- outside this statement it
  -- no longer shares the candidate CTE's locks, and two workers could then race
  -- over the same retirement.
end;
$$;


-- 6. Lookups that must never be built as PostgREST filters ---------------------
--
-- WHY THESE ARE RPCs.
--
-- Both questions below are keyed on the COMPOSITE (concierge_id, address), and a
-- composite IN-list has no PostgREST representation: there is no
-- `.in('(concierge_id,email)', ...)`. The workaround everybody reaches for is
--
--   .or(`and(concierge_id.eq.${id},email_normalized.eq.${email})`, ...)
--
-- which interpolates a recipient-controlled string into a filter GRAMMAR. That is
-- not hypothetical here. isEmail in supabase/functions/concierge-chat/index.ts:344
-- is
--
--   /^[^\s@]+@[^\s@]+\.[^\s@]+$/
--
-- -- it excludes whitespace and a second @, and nothing else. Commas, parentheses
-- and dots are all accepted, so `a,b)@x.de` is an address this system takes
-- today. Pasted into the string above it closes the and(), opens a new
-- disjunct, and the query stops meaning what it was written to mean. The
-- direction of the break is the dangerous one: a suppression lookup that
-- silently matches nothing reads as "not suppressed", and we mail somebody who
-- said no.
--
-- So: take JSON, let the driver do the quoting, never build a filter string. If
-- a future caller finds these awkward, the answer is a better RPC, not a filter.

-- Batch suppression check. Returns the SUBSET of the given pairs that is
-- suppressed; an address that is not on the list simply does not come back.
--
-- Raises rather than returning empty for malformed input. Deliberate: an empty
-- result means "none of these are suppressed", which is an instruction to send.
-- Garbage in must not be able to produce that sentence.
create or replace function public.concierge_followup_suppressed(p_pairs jsonb)
returns table (concierge_id uuid, email_normalized text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' then
    raise exception
      'concierge_followup_suppressed expects a jsonb array of {concierge_id, email} objects, got %',
      coalesce(jsonb_typeof(p_pairs), 'null');
  end if;

  return query
  with pairs as (
    -- The ::uuid cast raises on a malformed id, which is the same fail-closed
    -- choice as the array check above.
    select (e ->> 'concierge_id')::uuid as cid,
           lower(btrim(e ->> 'email'))  as norm
      from jsonb_array_elements(p_pairs) as e
     where jsonb_typeof(e) = 'object'
       and e ->> 'concierge_id' is not null
       and btrim(coalesce(e ->> 'email', '')) <> ''
  )
  select s.concierge_id, s.email_normalized
    from public.concierge_followup_suppressions s
    join pairs p
      on p.cid = s.concierge_id
     and p.norm = s.email_normalized;
end;
$$;

-- One click at the bottom of a follow-up mail, or a bounce webhook, or us by
-- hand. Two effects, one transaction, because doing half of this is worse than
-- doing none: recording the objection while leaving a queued mail in place would
-- send the very mail the person just asked us not to send.
--
-- Returns how many queued rows were cancelled, so the caller can log it.
--
-- Does NOT write to concierge_consents. The withdrawal row there needs the
-- wording snapshot of the grant it revokes (see buildConsentRow's unticked
-- branch), which is application knowledge, not database knowledge. The edge
-- function appends it; this function is the operational half.
--
-- 'sending' rows are cancelled too, and that is a best-effort race: an isolate
-- already inside the provider call will not notice. The sender therefore
-- re-checks suppression immediately before it transmits, and this cancel is what
-- stops every attempt after the current one.
create or replace function public.concierge_followup_unsubscribe(
  p_concierge_id uuid,
  p_email text,
  p_source text default 'visitor_unsubscribe'
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- lower + trim, matching normalizeConsentEmail() in
  -- supabase/functions/_shared/consent.ts. If that function ever changes, this
  -- must change with it or an unsubscribe stops matching its own queued row.
  v_norm text := lower(btrim(coalesce(p_email, '')));
  v_cancelled int;
begin
  if p_concierge_id is null or v_norm = '' then
    raise exception
      'concierge_followup_unsubscribe needs a concierge_id and a non-empty e-mail address';
  end if;

  -- First source wins. A second bounce, or an operator confirming what the
  -- visitor already did, must not overwrite how we first learned they wanted
  -- out. An unknown source hits the column's check constraint and raises.
  insert into public.concierge_followup_suppressions (concierge_id, email_normalized, source)
  values (p_concierge_id, v_norm, coalesce(nullif(btrim(p_source), ''), 'visitor_unsubscribe'))
  on conflict (concierge_id, email_normalized) do nothing;

  update public.concierge_followup_outbox o
     set status = 'cancelled',
         cancel_reason = 'unsubscribed'
   where o.concierge_id = p_concierge_id
     and o.email_normalized = v_norm
     and o.status in ('pending', 'sending');

  get diagnostics v_cancelled = row_count;
  return v_cancelled;
end;
$$;


-- 7. Privileges ---------------------------------------------------------------
--
-- 20260714000000_explicit_data_api_grants.sql grants SELECT/INSERT/UPDATE/DELETE
-- on every public table to anon and authenticated, and installs an ALTER DEFAULT
-- PRIVILEGES rule that hands the same set to every table created afterwards --
-- including the three above, automatically, the moment they were created. So
-- these revokes are load-bearing, not decorative.
--
-- Unlike concierge_consents there are no column grants here. The coach gets
-- NOTHING on these tables, not one column: sent_body is the text of a mail, the
-- suppression list is a list of people who objected, and the ops switch is a
-- global control. Any dashboard view of "who did we mail" goes through an edge
-- function that can scope and shape it. RLS is on with zero policies as well
-- (section 8), so a future migration that re-runs
-- `GRANT ... ON ALL TABLES IN SCHEMA public` re-opens the grant but still hits a
-- deny-all policy set -- two locks, because that migration is a real and
-- recurring hazard in this schema.
revoke all privileges on table public.concierge_followup_outbox from anon, authenticated;
revoke all privileges on table public.concierge_followup_suppressions from anon, authenticated;
revoke all privileges on table public.concierge_followup_ops from anon, authenticated;

-- Stated explicitly rather than inherited. service_role's grants would arrive on
-- their own via the ALTER DEFAULT PRIVILEGES rule in 20260714000000, but that
-- rule is recorded per GRANTOR and applies only to tables created by that same
-- role. If that ever stops holding, nothing here would say so -- REVOKE of a
-- privilege never held is a silent no-op -- and the symptom would be the send
-- path failing 42501 inside a retry loop.
grant select, insert, update, delete on table public.concierge_followup_outbox to service_role;

-- No UPDATE on suppressions: there is nothing to correct on a record that says
-- "this person asked to stop". Re-suppressing is an idempotent insert; removing
-- one at the person's own request is a DELETE.
grant select, insert, delete on table public.concierge_followup_suppressions to service_role;
revoke update on table public.concierge_followup_suppressions from service_role;

-- The service role reads the ops row and flips the flag. INSERT is left in place
-- although the row is created above: the primary key plus `check (id = 1)` make a
-- second row impossible anyway, so the privilege buys nothing an attacker wants
-- and buys us the ability to RESTORE the row if it is ever missing -- which
-- matters, because concierge_followup_claim() treats a missing row as disabled
-- and would silently stop the whole pipeline until someone put it back.
--
-- DELETE is revoked. Deleting the switch is never a legitimate operation: it does
-- not turn sending off (that is an UPDATE), it removes the operator's ability to
-- turn it back on.
grant select, insert, update on table public.concierge_followup_ops to service_role;
revoke delete on table public.concierge_followup_ops from service_role;

-- No sequences are created: both primary keys are a uuid default
-- gen_random_uuid() and a fixed int 1, so the ALTER DEFAULT PRIVILEGES sequence
-- rule in 20260714000000 has nothing to attach to and there is nothing to
-- revoke. Do not switch the outbox to a bigserial -- a gapless, guessable id is
-- itself a disclosure of how many people a sender has mailed.

-- Functions. Postgres auto-grants EXECUTE to PUBLIC at creation time and
-- anon/authenticated inherit through PUBLIC, so the revokes below are the whole
-- gate: all three are SECURITY DEFINER and therefore bypass the table privileges
-- and the RLS above entirely. An anon-executable
-- concierge_followup_unsubscribe(uuid, text, text) would let any script on the
-- internet suppress any address for any coach -- a denial-of-lead endpoint with
-- no authentication at all. Same treatment 20260714000000 gives
-- concierge_rate_limit_hit, same reason.
revoke execute on function public.concierge_followup_claim(int, timestamptz) from public;
revoke execute on function public.concierge_followup_suppressed(jsonb) from public;
revoke execute on function public.concierge_followup_unsubscribe(uuid, text, text) from public;

grant execute on function public.concierge_followup_claim(int, timestamptz) to service_role;
grant execute on function public.concierge_followup_suppressed(jsonb) to service_role;
grant execute on function public.concierge_followup_unsubscribe(uuid, text, text) to service_role;


-- 8. RLS ----------------------------------------------------------------------
--
-- Enabled with ZERO policies on all three, the concierge_rate_limits pattern
-- (20260625130000). No policy means no row satisfies any check, for every role
-- except service_role, which bypasses RLS. There is deliberately no
-- "owners read own outbox" policy: the useful version of that view needs
-- shaping (the coach has no business reading another sender's suppressions, and
-- sent_body is a private message to a third party), and shaping belongs in an
-- edge function where it can be reasoned about, not in a policy predicate that
-- has to be re-audited every time a column is added.
--
-- Postgres has no `create policy if not exists`, so any policy added here later
-- must `drop policy if exists` first, the way every other file in this schema
-- does, so the migration can be re-applied against a database that already has
-- it. There are none to drop today.
alter table public.concierge_followup_outbox enable row level security;
alter table public.concierge_followup_suppressions enable row level security;
alter table public.concierge_followup_ops enable row level security;


-- ------------------------------------------------------------------------------
-- OPERATOR RUNBOOK
--
-- STOP EVERYTHING, right now, no deploy:
--
--   update public.concierge_followup_ops
--      set sending_enabled = false, note = 'why', updated_at = now()
--    where id = 1;
--
-- The next claim returns zero rows. Rows already claimed and in flight will
-- finish; nothing new is picked up.
--
-- TURN IT ON: the same UPDATE with true. Ships false on purpose.
--
-- WHAT IS STUCK:
--
--   select status, count(*) from public.concierge_followup_outbox group by 1;
--   select * from public.concierge_followup_outbox
--    where status = 'sending' and claimed_at < now() - interval '5 minutes';
--
-- The second query should stay empty in a healthy system: the claim function
-- retires those rows itself. A persistent result there means claims have stopped
-- running at all, which the first query will not show you.
--
-- RETENTION. Not implemented and not scheduled -- there is no pg_cron in this
-- project (see the runbook note at the foot of 20260808120000). The sent_* rows
-- are evidence of a commercial mail and share the consent ledger's three-year
-- §195 BGB window, so they must NOT be purged on a shorter one. Suppressions are
-- never purged: an objection has no expiry date, and forgetting one is the only
-- error in this file that cannot be undone by re-running anything.
