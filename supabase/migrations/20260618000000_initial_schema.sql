create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('customer', 'admin')) default 'customer',
  company_name text not null default '',
  email text not null
);

create table automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  summary text not null,
  outcome_description text not null,
  category text not null,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'eur',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table automation_requests (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references automations(id),
  customer_id uuid not null references profiles(id),
  status text not null check (
    status in ('requested', 'payment_pending', 'paid', 'in_progress', 'delivered', 'cancelled')
  ) default 'requested',
  stripe_checkout_session_id text,
  delivery_notes text,
  requested_at timestamptz not null default now(),
  paid_at timestamptz,
  delivered_at timestamptz
);

alter table profiles enable row level security;
alter table automations enable row level security;
alter table automation_requests enable row level security;

create function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

create policy "users read own profile" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "users update own profile" on profiles
  for update using (id = auth.uid());
create policy "users insert own profile" on profiles
  for insert with check (id = auth.uid());

create policy "anyone reads active automations" on automations
  for select using (is_active = true or is_admin());
create policy "admins manage automations" on automations
  for insert with check (is_admin());
create policy "admins update automations" on automations
  for update using (is_admin());

create policy "customers read own requests" on automation_requests
  for select using (customer_id = auth.uid() or is_admin());
create policy "customers create own requests" on automation_requests
  for insert with check (customer_id = auth.uid());
create policy "admins update requests" on automation_requests
  for update using (is_admin());
