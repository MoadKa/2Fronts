-- Catalog "request what's missing" capture: the waitlist form moved to the
-- bottom of the catalog and now also collects a free-text request and an
-- explicit marketing-consent opt-in (DSGVO: active checkbox, consent + timestamp
-- recorded). Written only by the waitlist-signup edge function (service role).

alter table waitlist_signups
  add column if not exists message text,
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists marketing_consent_at timestamptz;
