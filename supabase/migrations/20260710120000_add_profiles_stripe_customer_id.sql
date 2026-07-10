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
