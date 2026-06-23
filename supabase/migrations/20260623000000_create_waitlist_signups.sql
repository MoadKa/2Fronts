-- Waitlist signups (Sprint B, #12).
-- The public landing page at "/" captures interested visitors' email addresses
-- before launch. Rows are written ONLY by the `waitlist-signup` edge function
-- using the service-role client; the public (anon/authenticated) roles get no
-- INSERT and no SELECT, so the list can never be read or stuffed from the
-- browser.

create table waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  locale text,
  source text,
  created_at timestamptz not null default now()
);

-- One signup per email, case-insensitively. The edge function relies on this to
-- detect a duplicate and respond with a friendly "already on the list" instead
-- of writing a second row. A unique index on lower(email) (rather than a plain
-- unique constraint) is what lets "Me@X.com" and "me@x.com" collide.
create unique index waitlist_signups_email_lower_idx on waitlist_signups (lower(email));

alter table waitlist_signups enable row level security;

-- No policies are created for anon/authenticated, so with RLS enabled those
-- roles can neither SELECT nor INSERT. The service-role client used by the
-- edge function bypasses RLS entirely, which is the only intended write path.
-- (An admins-manage policy is intentionally omitted; the list is read via the
-- service role / SQL, not the app.)
