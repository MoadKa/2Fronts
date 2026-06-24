-- Subscription billing for automations (#25, epic #22).
--
-- Today every automation is a one-time charge (create-checkout-session uses
-- mode:'payment'). The AI Booking Concierge is a EUR 79/month subscription, so
-- the catalog needs to say which billing model an automation uses, and a paid
-- provision needs to remember the Stripe subscription/customer it belongs to so
-- a later cancellation maps back to the concierge to deactivate.
--
-- Backward-compatible by construction: pricing_model defaults to 'one_time', so
-- every existing automation keeps the unchanged mode:'payment' path. The new
-- columns on automation_provisions are nullable and only populated for
-- subscription purchases.

-- 1. How an automation is billed. ---------------------------------------------
-- one_time      -> existing mode:'payment' inline price_data (default)
-- subscription  -> mode:'subscription' recurring price_data
alter table automations
  add column pricing_model text not null default 'one_time'
    check (pricing_model in ('one_time', 'subscription')),
  -- Only meaningful when pricing_model = 'subscription'. Stripe's recurring
  -- interval; we ship 'month' for the concierge. Nullable for one-time rows.
  add column recurring_interval text
    check (recurring_interval in ('day', 'week', 'month', 'year'));

-- A subscription automation must declare its interval; a one-time one must not.
alter table automations
  add constraint automations_recurring_interval_matches_model check (
    (pricing_model = 'subscription' and recurring_interval is not null) or
    (pricing_model = 'one_time' and recurring_interval is null)
  );

-- 2. Remember the Stripe subscription a provision belongs to. ------------------
-- Stored on checkout.session.completed (subscription mode). subscription.deleted
-- later finds the provision by stripe_subscription_id to deactivate the
-- concierge. customer_id is kept for support / future billing-portal links.
alter table automation_provisions
  add column stripe_subscription_id text,
  add column stripe_customer_id text;

create unique index automation_provisions_stripe_subscription_id_idx
  on automation_provisions (stripe_subscription_id)
  where stripe_subscription_id is not null;
