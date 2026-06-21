-- Fulfillment pipeline v1 (T1). Generalizes the Twilio-shaped
-- automation_provisions into a connector-agnostic shape, and adds the three
-- tables the connector pipeline runs on:
--   connector_connections -- per-customer authorization to reach a tool (OAuth)
--   connector_registry    -- public catalog driving the Supported-software page
--   leads                 -- every inbound lead, with its filing status
--
-- Design: akaou-main-design-20260621-182708.md (eng + design review).

-- 1. Generalize automation_provisions -----------------------------------------
-- connector_type tells the orchestrator which connector handles a provision.
-- Existing rows are all the missed-call/Twilio product, so default to that.
-- config holds connector-specific settings (e.g. the target spreadsheet id +
-- the confirmed column mapping) that don't earn dedicated columns the way the
-- Twilio fields once did.
alter table automation_provisions
  add column connector_type text not null default 'twilio_missed_call',
  add column config jsonb not null default '{}'::jsonb;

-- The Twilio-specific columns are no longer universal. Drop their NOT NULL so a
-- non-Twilio provision (e.g. google_sheets) can omit them.
alter table automation_provisions
  alter column business_name drop not null,
  alter column booking_link drop not null;

-- 2. connector_connections ----------------------------------------------------
-- One row per (customer, connector): the customer's authorization to reach into
-- their own tool. The refresh token is the crown jewel -- encrypted at rest and
-- never sent to the browser (column-level REVOKE below + service-role-only
-- writes/reads of the secret).
create table connector_connections (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  connector_type text not null,
  encrypted_refresh_token text,
  scope text,
  external_account_email text,
  status text not null check (status in ('active', 'revoked', 'error')) default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, connector_type)
);

alter table connector_connections enable row level security;

-- Customers may see THAT they have a connection and its status, but never the
-- token. Column-level REVOKE stops `select *` from leaking the secret even
-- through a permitted row. The service-role client (edge functions) bypasses
-- both RLS and column grants. Frontend queries must select explicit columns,
-- not '*'.
revoke select (encrypted_refresh_token) on connector_connections from authenticated, anon;

create policy "customers read own connections" on connector_connections
  for select using (customer_id = auth.uid() or is_admin());

-- All writes (token storage, status changes) happen server-side via the
-- service-role client in google-oauth-callback / connector functions.
create policy "admins manage connections" on connector_connections
  for all using (is_admin()) with check (is_admin());

-- 3. connector_registry -------------------------------------------------------
-- The catalog of what 2Fronts can connect to. Drives the public
-- "Supported software" page: is_public + status='live' shown full-color;
-- 'coming_soon' shown dimmed. Adding a row updates the storefront -- no code.
create table connector_registry (
  connector_type text primary key,
  display_name text not null,
  category text,
  status text not null check (status in ('live', 'coming_soon')) default 'coming_soon',
  is_public boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table connector_registry enable row level security;

-- Public storefront: anyone (incl. logged-out visitors) reads public rows --
-- same posture as "anyone reads active automations". Admins see everything,
-- including internal/non-public connectors.
create policy "anyone reads public connectors" on connector_registry
  for select using (is_public = true or is_admin());
create policy "admins manage connectors" on connector_registry
  for all using (is_admin()) with check (is_admin());

insert into connector_registry (connector_type, display_name, category, status, is_public, sort_order) values
  ('google_sheets',      'Google Sheets',    'Tabellen & Leads', 'live',        true,  10),
  ('hubspot',            'HubSpot',          'CRM',              'coming_soon', true,  20),
  ('pipedrive',          'Pipedrive',        'CRM',              'coming_soon', true,  30),
  ('outlook_email',      'Outlook / E-Mail', 'Kommunikation',    'coming_soon', true,  40),
  -- The missed-call delivery mechanism is internal plumbing, not a
  -- customer-facing "supported software", so it stays off the public page.
  ('twilio_missed_call', 'Telefon (Anrufe)', 'Telefonie',        'live',        false, 90);

-- 4. leads --------------------------------------------------------------------
-- Every inbound lead, regardless of source. payload is the raw captured data;
-- the connector's run() step reads it, files it, and moves status forward.
-- needs_review is the safe stop state (F3): a low-confidence/drift situation
-- holds here and alerts, rather than writing a guess into the customer's tool.
create table leads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  automation_id uuid references automations(id),
  source text,
  payload jsonb not null,
  status text not null check (status in ('received', 'filed', 'needs_review', 'failed')) default 'received',
  filed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_customer_id_idx on leads (customer_id);
create index leads_status_idx on leads (status);

alter table leads enable row level security;

create policy "customers read own leads" on leads
  for select using (customer_id = auth.uid() or is_admin());
create policy "admins manage leads" on leads
  for all using (is_admin()) with check (is_admin());
