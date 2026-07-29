-- Demo concierges: disclosure + expiry.
--
-- A concierge at /c/<slug> is a PUBLIC page. When one is built as a sales demo
-- for a prospect, that page speaks as a named real person's business — on
-- 2Fronts' domain, without their consent, and (until now) with no disclosure
-- and no end date. Two such demos were already live when this was found.
--
-- is_demo marks those rows so the public page can say what it is. demo_expires_at
-- makes them stop serving on their own, so a prospect who says no doesn't leave a
-- bot running under their name indefinitely.
--
-- Both are defaulted/nullable, so every existing row keeps its exact current
-- behaviour: a real customer's concierge is is_demo = false with no expiry.
--
-- No RLS or GRANT changes needed: new columns on an existing table inherit the
-- table's privileges, and "owners manage own concierges" already scopes writes.

alter table concierges
  add column if not exists is_demo boolean not null default false,
  add column if not exists demo_expires_at timestamptz;

comment on column concierges.is_demo is
  'True for sales-demo concierges built for a prospect. The public page renders a visible disclosure line when set.';

comment on column concierges.demo_expires_at is
  'When a demo stops serving. NULL = never expires (every real customer row). Enforced in the concierge-chat edge function rather than by a constraint, so an expired row stays readable and revivable by its owner.';

-- NOTE: existing demo rows are NOT flagged here.
--
-- This repository is public, and naming the prospects a demo was built for
-- would publish, permanently and in plain text, both who they are and the fact
-- that a bot speaking for their business was set up without asking them. That
-- is the same exposure this migration exists to close, so it is not traded for
-- convenience.
--
-- Flag them by hand instead, once, from the SQL editor (the slugs are in the
-- local DEMO_RUNBOOK, which is untracked):
--
--   update concierges set is_demo = true where slug in ('…', '…');
--
-- Leave demo_expires_at null on anything mid-outreach: expiring a demo
-- retroactively breaks a link that may already be sitting in someone's inbox.
