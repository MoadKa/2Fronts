-- Tracks STOP replies from a customer's lead (the person who got the
-- automated missed-call SMS), scoped per-provision -- distinct from any
-- future cold-outreach suppression list (a separate B2B prospecting
-- concern, not yet built), which must not be conflated with this table.

create table automation_provision_opt_outs (
  id uuid primary key default gen_random_uuid(),
  provision_id uuid not null references automation_provisions(id),
  phone text not null,
  created_at timestamptz not null default now(),
  unique (provision_id, phone)
);

alter table automation_provision_opt_outs enable row level security;

create policy "admins read opt-outs" on automation_provision_opt_outs
  for select using (is_admin());
