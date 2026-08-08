-- concierge_consents -- the append-only evidence ledger for follow-up e-mail
-- consent (§7 Abs. 2 UWG, Art. 7 Abs. 1 DSGVO).
--
-- WHAT THIS TABLE IS FOR
--
-- §7 Abs. 2 UWG puts the burden of proof for consent on the SENDER. Proving a
-- consent means reproducing exactly what the visitor read at the moment they
-- ticked the box: which wording, in which language, naming which business. So
-- every row here stores the server's own rendering of that text, not a pointer
-- to wherever the current wording happens to live. Wording is versioned in
-- supabase/functions/_shared/consent.ts (CONSENT_NOTICE_VERSION); changing one
-- character there is a NEW version, and old rows keep proving what they were
-- collected under. There is no lawful way to retro-fit new wording onto consent
-- already given, which is also the reason this table is append-only.
--
-- The columns below are exactly the `ConsentRow` interface in that module, same
-- names, plus the three the database owns (id, created_at) and the double
-- opt-in pair (confirm_token, confirm_token_expires_at). buildConsentRow()
-- deliberately produces NO created_at: the database owns the timestamp, because
-- a time supplied by an edge isolate is a clock we do not control appearing in
-- evidence.
--
-- State is DERIVED, never stored: latest row wins, ties resolve to 'withdrawn'
-- (effectiveConsentState in consent.ts). That only works if rows never change
-- after the fact -- hence the append-only trigger at the bottom.
--
-- No transaction wrapper: the Supabase CLI owns the transaction for a migration
-- file, and a nested begin;/commit; breaks it. This project has been burned by
-- that before.

-- 1. The ledger ---------------------------------------------------------------
--
-- !! DO NOT ADD `REFERENCES` TO concierge_id, conversation_id OR sender_owner_id !!
--
-- This is deliberate and it is counter-intuitive, so read this before you
-- "fix" it. A foreign key here would need an ON DELETE action, and every
-- available action is fatal:
--
--   * ON DELETE SET NULL issues an internal UPDATE on this child row. That
--     UPDATE fires the append-only trigger below, which RAISES -- so deleting a
--     concierge (or an auth.users row, which cascades to concierges) would fail
--     forever. `concierges` and `auth.users` become permanently undeletable, and
--     the failure surfaces as an opaque trigger error somewhere far from the
--     delete the operator actually issued.
--   * ON DELETE CASCADE would destroy the evidence at exactly the moment it is
--     most likely to be needed -- a coach deleting their setter must not be able
--     to delete the proof that a visitor consented to being mailed.
--   * ON DELETE RESTRICT / NO ACTION makes deletion impossible by design.
--
-- So these three are plain uuids: pointers, not constraints. They keep their
-- value after the thing they point at is gone, which is the whole point of an
-- evidence ledger. Referential drift is accepted and intended here.
create table if not exists public.concierge_consents (
  id uuid primary key default gen_random_uuid(),

  -- Who the consent was given TO. See the FK warning above: no references.
  concierge_id uuid not null,
  -- Which chat it came out of. Nullable: consent can be recorded outside a
  -- conversation (operator action, ESP bounce, unsubscribe click).
  conversation_id uuid,
  -- Denormalised from concierges.owner_id at write time. THIS, not
  -- concierge_id, is what still identifies the sender after a coach deletes and
  -- re-creates their setter (observed behaviour, see 20260729100000's header).
  -- Nullable because a row can outlive our knowledge of the owner.
  sender_owner_id uuid,

  -- As typed, for showing back to a human. And the subject key half, lowercased
  -- + trimmed only (normalizeConsentEmail): no dot- or plus-stripping, those are
  -- Gmail conventions, not RFC ones, and folding a+b@x.de into a@x.de would bind
  -- one person's consent to a different mailbox.
  visitor_email text not null,
  visitor_email_norm text not null,

  -- 'granted' -> box ticked; 'confirmed' -> double opt-in link clicked, the only
  -- state that may actually send (maySendFollowup); 'withdrawn' -> taken back.
  action text not null check (action in ('granted', 'confirmed', 'withdrawn')),

  -- The six ConsentSource values, kept in sync with the union in consent.ts.
  source text not null check (source in (
    'contact_form',           -- ticked the box on the /c/:slug contact form
    'contact_form_unticked',  -- resubmitted the form WITHOUT the tick -> withdrawal
    'visitor_confirmation',   -- clicked the link in the double-opt-in mail
    'visitor_unsubscribe',    -- clicked unsubscribe in a follow-up mail
    'provider_bounce',        -- hard bounce / complaint reported by the ESP
    'operator'                -- manual, by us, on request
  )),

  -- Only 'email' exists. Named anyway rather than implied: OLG Hamm 18 U 154/22
  -- pulled messenger DMs into "elektronische Post", so a consent that does not
  -- name its channel proves nothing about its scope.
  channel text not null check (channel in ('email')),

  -- The wording snapshot. This is the evidence. notice_label is the short
  -- <label> the visitor clicked; notice_text is the five-sentence notice beside
  -- it; rendered_business_name is the sender name that was substituted into
  -- both, server-side, and matched against what the client claimed it rendered.
  notice_version text not null,
  notice_label text not null,
  notice_text text not null,
  rendered_business_name text not null,
  locale text not null check (locale in ('de', 'en')),

  -- Circumstantial proof of the act. Personal data, minimised, and NOT readable
  -- by the coach -- see the column-scoped grant below.
  visitor_ip text,
  visitor_user_agent text,

  -- Double opt-in. Set on 'granted' rows only; the confirmation endpoint looks
  -- the row up by this token and writes a NEW 'confirmed' row (it never updates
  -- this one -- the ledger is append-only). Unique so a token identifies exactly
  -- one grant; null on every other action, and Postgres treats nulls as
  -- distinct, so any number of rows may carry none.
  confirm_token text unique,
  confirm_token_expires_at timestamptz,

  -- The database owns the timestamp. Never supplied by the caller.
  created_at timestamptz not null default now()
);

comment on table public.concierge_consents is
  'Append-only evidence ledger for follow-up e-mail consent (§7 Abs. 2 UWG). '
  'RETENTION: 3 years from created_at, matching CONSENT_RETENTION_YEARS in '
  'supabase/functions/_shared/consent.ts, the wording of the notice itself and '
  'the privacy page. Three years is §195 BGB -- the window in which a claim over '
  'an unlawful mail can still arrive, so evidence must outlive it and not much '
  'longer. Rows can never be updated, by anyone; only the service role may '
  'delete, and only for that retention purge.';

-- 2. Index --------------------------------------------------------------------
--
-- (concierge_id, visitor_email_norm) is the SUBJECT KEY: "what is this address's
-- consent state with this sender". created_at desc serves the derivation, which
-- only ever cares about the latest rows.
--
-- Never index or look up by concierges.slug. slug is owner-mutable (the
-- "owners manage own concierges" policy is `for all`, and no trigger locks that
-- column), so a coach could rename their way onto another sender's evidence.
create index if not exists concierge_consents_subject_idx
  on public.concierge_consents (concierge_id, visitor_email_norm, created_at desc);

-- 3. Grants -------------------------------------------------------------------
--
-- 20260714000000_explicit_data_api_grants.sql grants SELECT, INSERT, UPDATE and
-- DELETE on EVERY public table to anon and authenticated, and installs an
-- ALTER DEFAULT PRIVILEGES rule that hands the same set to every table created
-- afterwards -- including this one, automatically, the moment it is created
-- above. So the revoke below is load-bearing, not decorative: without it every
-- signed-in user could read visitor IPs and live confirmation tokens through
-- PostgREST.
--
-- And it must be REVOKE ALL followed by column-level GRANTs, never a column
-- REVOKE: in Postgres, table-level SELECT is a single whole-table privilege that
-- implicitly covers every column, present and future. "table SELECT minus one
-- column" cannot even be expressed in the catalog (pg_class.relacl vs
-- pg_attribute.attacl). This is the exact mistake 20260808090000 had to undo on
-- connector_connections; same pattern, applied up front this time.
--
-- STANDING FOOTGUN: any future migration that repeats
-- `GRANT ... ON ALL TABLES IN SCHEMA public TO anon, authenticated` silently
-- re-opens all four withheld columns, because it hands back the table-level
-- privilege. Such a migration must exclude this table and then re-run the
-- revoke + column grants below.
revoke all privileges on table public.concierge_consents from anon, authenticated;

-- Four columns are withheld from the coach on purpose:
--   visitor_ip, visitor_user_agent -- personal data collected to prove the act
--     to a court or a DPA, not to profile a lead. The coach's lawful interest is
--     "did this person consent", which the granted columns answer in full.
--   confirm_token -- a LIVE credential. Anyone holding it can complete a
--     double opt-in on the visitor's behalf, which is precisely the forgery the
--     confirmation step exists to prevent. A sender who can mint their own
--     confirmations has no evidence at all.
--   confirm_token_expires_at -- withheld with it; on its own it only leaks the
--     token's liveness, and there is no screen that needs it.
grant select (
  id,
  concierge_id,
  conversation_id,
  sender_owner_id,
  visitor_email,
  visitor_email_norm,
  action,
  source,
  channel,
  notice_version,
  notice_label,
  notice_text,
  rendered_business_name,
  locale,
  created_at
) on table public.concierge_consents to authenticated;

-- anon gets NOTHING, not even a column. No RLS policy on this table can ever be
-- true for a logged-out visitor (every branch needs auth.uid() or is_admin()),
-- so a grant would widen the attack surface and buy nothing. The public chat
-- page never touches this table from the browser: consent is written, read and
-- confirmed exclusively by service-role edge functions.
--
-- service_role keeps SELECT/INSERT/DELETE from the default-privileges rule and
-- is the only writer. Its UPDATE is revoked so that an accidental update from an
-- edge function fails at privilege-check time (42501) rather than relying on the
-- trigger alone; the trigger stays as the backstop that also covers `postgres`
-- and the SQL editor, which no revoke can constrain.
-- Stated explicitly rather than inherited. service_role's SELECT/INSERT/DELETE
-- would arrive on their own via the ALTER DEFAULT PRIVILEGES rule in
-- 20260714000000, but that rule is recorded per GRANTOR and applies only to
-- tables created by that same role. If that ever stops holding, nothing here
-- would say so: REVOKE of a privilege never held is a silent no-op, and the
-- symptom would be every consent insert failing 42501 inside a best-effort
-- try/catch -- the evidence ledger quietly not being written. This is the same
-- argument the file already makes for the anon/authenticated column grants.
grant select, insert, delete on table public.concierge_consents to service_role;

revoke update on table public.concierge_consents from service_role;

-- No sequence is created: the primary key is a uuid with gen_random_uuid(), so
-- there is nothing for the ALTER DEFAULT PRIVILEGES sequence rule in
-- 20260714000000 to attach to, and nothing to revoke. Do not switch this table
-- to a bigserial -- a gapless, guessable row count is itself a disclosure about
-- how many people a sender has mailed.

-- 4. Append-only ---------------------------------------------------------------
--
-- UPDATE raises for EVERYONE, service_role included. Evidence that can be edited
-- is not evidence: if the sender's own backend can rewrite the wording, the
-- timestamp or the action on a stored consent, the ledger proves nothing about
-- what a visitor actually saw and no court has reason to believe it. Corrections
-- are made the way the ledger is designed for -- by appending a new row.
--
-- DELETE raises for everyone EXCEPT the service role, which must stay able to
-- run the 3-year retention purge (see the footer). That is the one legitimate
-- reason a row ever leaves this table.
--
-- security definer + pinned search_path per the convention in this schema
-- (20260618030000, 20260710120000, 20260727130000): it stops a schema squatting
-- in the caller's search_path from shadowing auth.role() and deciding for itself
-- who counts as the service role.
create or replace function public.concierge_consents_append_only() returns trigger as $$
declare
  is_service boolean;
begin
  if tg_op = 'UPDATE' then
    raise exception
      'concierge_consents is append-only: rows may never be updated, by any role. Append a new row instead.';
    -- Unreachable -- RAISE aborts the statement. PL/pgSQL wants a trigger
    -- function branch to end in a RETURN, so this is here purely to keep the
    -- shape valid; it never executes, and if it somehow did, returning NEW would
    -- be the wrong answer.
    return new;
  end if;

  -- tg_op = 'DELETE' from here.
  --
  -- "Is this the service role" has to be asked twice, because the two callers
  -- that matter answer differently. Through PostgREST the role arrives as a JWT
  -- claim, which is what auth.role() reads. In psql, the Supabase SQL editor and
  -- the pgTAP suite there is no JWT at all -- auth.role() is NULL there (see the
  -- operator notes in 20260727120000 and 20260729100000) and the role arrives as
  -- `set local role service_role`, which is what current_setting('role') reads.
  -- Asking only one of the two would either pass in production and fail every
  -- test, or the reverse.
  is_service :=
    coalesce(auth.role(), '') = 'service_role'
    or coalesce(current_setting('role', true), 'none') = 'service_role';

  if not is_service then
    raise exception
      'concierge_consents rows may only be deleted by the service role, and only for the 3-year retention purge';
  end if;

  return old;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists concierge_consents_append_only on public.concierge_consents;
create trigger concierge_consents_append_only
  before update or delete on public.concierge_consents
  for each row
  execute function public.concierge_consents_append_only();

-- 5. RLS ------------------------------------------------------------------------
alter table public.concierge_consents enable row level security;

-- Postgres has no `create policy if not exists`, so drop first. Every policy in
-- this file is written that way so the migration can be re-applied against a
-- database that already has it.
drop policy if exists "senders read own consent evidence" on public.concierge_consents;

-- SELECT only. There is deliberately NO insert, update or delete policy on this
-- table: the service role bypasses RLS entirely and is the only writer, so any
-- write policy here would exist purely to be exploited later.
--
-- The FIRST branch, sender_owner_id = auth.uid(), is the one that keeps working
-- after a coach deletes their setter and creates a new one. The old
-- concierge_id then points at a row that no longer exists (there is no FK, by
-- design -- see the top of this file), so the third branch's EXISTS goes false
-- and the coach would lose sight of the consents collected under their own
-- previous setter. sender_owner_id is denormalised for exactly this case: the
-- person is the same person, and the evidence is still theirs to answer for.
create policy "senders read own consent evidence" on public.concierge_consents
  for select using (
    sender_owner_id = auth.uid()
    or is_admin()
    or exists (
      select 1 from public.concierges c
      where c.id = concierge_consents.concierge_id
        and c.owner_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------------------
-- OPERATOR RUNBOOK -- the retention purge is MANUAL. There is no scheduler.
--
-- The installed extensions are uuid-ossp, pg_net, pg_stat_statements, pgcrypto,
-- plpgsql and supabase_vault. No pg_cron, no pg_partman, no job runner of any
-- kind, and nothing in supabase/config.toml schedules anything. Saying so
-- plainly is
-- the point: a retention promise that quietly depends on a cron nobody installed
-- is worse than an honest manual task, because the privacy page and the notice
-- text both tell visitors we keep this for three years and no longer.
--
-- Run this, by hand, at least quarterly, with the service key (nothing else may
-- delete here):
--
--   begin;
--   set local request.jwt.claims = '{"role":"service_role"}';
--   delete from public.concierge_consents
--     where created_at < now() - interval '3 years';
--   commit;
--
-- CONSENT_RETENTION_YEARS = 3 in supabase/functions/_shared/consent.ts is the
-- single source of that number; the notice wording and the privacy page repeat
-- it. Change one and you must change all four.
--
-- Note for future migrations: the append-only trigger fires for `postgres` too,
-- so a migration that needs to backfill a column on this table must disable the
-- trigger for the duration (alter table ... disable trigger
-- concierge_consents_append_only) and re-enable it in the same migration. If you
-- find yourself doing that to CHANGE stored evidence rather than to add a
-- column, stop: that is the thing this table exists to make impossible.
