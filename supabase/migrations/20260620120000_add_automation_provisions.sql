-- Adds support for automated (non-manual) fulfillment of automations.
-- requires_provisioning is a separate concern from `category` (a free-text
-- user-facing classification) -- this is an internal fulfillment-mechanism
-- flag the catalog UI never shows.

alter table automations
  add column requires_provisioning boolean not null default false;

create type automation_provision_status as enum (
  'pending', 'provisioning', 'active', 'failed', 'cancelled'
);

create table automation_provisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references automation_requests(id),
  business_name text not null,
  booking_link text not null,
  business_hours jsonb,
  twilio_phone_number text unique,
  twilio_phone_number_sid text,
  status automation_provision_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index automation_provisions_twilio_phone_number_idx
  on automation_provisions (twilio_phone_number);

alter table automation_provisions enable row level security;

create policy "customers read own provisions" on automation_provisions
  for select using (
    is_admin() or exists (
      select 1 from automation_requests
      where automation_requests.id = automation_provisions.request_id
        and automation_requests.customer_id = auth.uid()
    )
  );

-- Business details (name/booking link/hours) are collected from the customer
-- at REQUEST time, before checkout -- not invented later by the webhook,
-- which has no UI to ask for them. The webhook only transitions
-- pending -> provisioning using the service-role client (bypasses RLS).
create policy "customers create own pending provision" on automation_provisions
  for insert with check (
    status = 'pending' and exists (
      select 1 from automation_requests
      where automation_requests.id = automation_provisions.request_id
        and automation_requests.customer_id = auth.uid()
    )
  );

create policy "admins manage provisions" on automation_provisions
  for insert with check (is_admin());

create policy "admins update provisions" on automation_provisions
  for update using (is_admin());

-- Note: the stripe-webhook edge function writes to this table using the
-- service-role client (bypasses RLS, same pattern as automation_requests'
-- "admins update requests" policy combined with server-side-only writes for
-- the paid/payment_pending transitions).
