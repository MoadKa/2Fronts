-- Lead qualification + wish collection (founder feature 2026-06-25).
--
-- M1: dedicated wishes table. Unlike waitlist_signups (one row per email), every
-- catalog "what's missing?" submission is its own row so repeat requests from the
-- same person are never lost. Written only by the submit-wish edge function
-- (service role); RLS on with no anon/authenticated policies.
create table wishes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  message text,
  industry text,
  locale text,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table wishes enable row level security;

-- M2: a concierge's ideal-customer criteria, configured in the setup wizard.
-- Shape (see src/lib/qualification.ts QualCriterion[]):
--   [{ "id": "budget", "question": "...", "options": [{ "label": "...", "qualifies": true }] }]
alter table concierges
  add column if not exists qualification_criteria jsonb not null default '[]'::jsonb;

-- M3: per-conversation qualification. answers = the visitor's chosen options
-- (QualAnswer[]); qualified is null until at least one criterion is answered,
-- then true only when every answered criterion's chosen option qualifies.
alter table concierge_conversations
  add column if not exists qualification_answers jsonb not null default '[]'::jsonb,
  add column if not exists qualified boolean;
