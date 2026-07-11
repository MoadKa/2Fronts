-- One Stripe Customer per coach (trial reinstatement, design doc 2026-07-10).
--
-- create-checkout-session used to call stripe.customers.create on EVERY
-- subscription checkout, so a coach who retried checkout (or ever subscribed
-- again) collected a fresh Stripe Customer each time. Store the id on the
-- profile so the edge function can reuse the existing Customer and only
-- create + persist one when none is stored yet.
alter table profiles
  add column stripe_customer_id text;

-- Two profiles must never point at the same Stripe Customer. Partial index
-- so the (default) null value stays unconstrained.
create unique index profiles_stripe_customer_id_idx
  on profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- Lock the column against client writes. The "users update own profile" RLS
-- policy lets a user update their own profile ROW, which would include this
-- column -- but stripe_customer_id is billing-trust: it decides which Stripe
-- Customer future subscriptions (and the trial-eligibility check) attach to,
-- so only the edge functions (service_role) may write it. Same BEFORE UPDATE
-- trigger pattern as the role lock in 20260618030000_lock_profile_role_column:
-- a non-service_role writer silently keeps the OLD value; every other column
-- in the same statement still goes through.
create function prevent_stripe_customer_id_client_write() returns trigger as $$
begin
  if new.stripe_customer_id is distinct from old.stripe_customer_id
     and auth.role() is distinct from 'service_role' then
    new.stripe_customer_id := old.stripe_customer_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger profiles_lock_stripe_customer_id
  before update on profiles
  for each row
  execute function prevent_stripe_customer_id_client_write();

-- Serves the trial-eligibility join (automation_provisions -> automation_requests
-- by customer_id) and the "customers read own requests/provisions" RLS
-- predicates, which all filter automation_requests on customer_id.
create index if not exists automation_requests_customer_id_idx
  on automation_requests (customer_id);
