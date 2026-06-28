-- Localised catalog content. The base columns (name, summary,
-- outcome_description) stay the PRIMARY language (German). `translations` holds
-- human-authored overrides per locale, shape:
--   { "en": { "name": "...", "summary": "...", "outcome_description": "..." } }
-- The frontend shows the override for the active language and falls back to the
-- base column when a field is missing. This is the few-entities / few-locales
-- pattern (localised JSONB field) — no translation-table join, full quality
-- control, and machine translation is deliberately NOT used.
alter table automations
  add column if not exists translations jsonb not null default '{}'::jsonb;

-- Seed English for the flagship AI Booking Concierge so non-German visitors get
-- a card they can actually read, instead of German prose. Also normalise the
-- German base name to German (it was authored in English). Guarded so it only
-- touches the concierge row and only if untouched.
update automations
set
  name = case when name = 'AI Booking Concierge' then 'KI-Buchungsassistent' else name end,
  translations = translations || jsonb_build_object(
    'en', jsonb_build_object(
      'name', 'AI Booking Concierge',
      'summary', 'An AI assistant that advises your visitors around the clock and books their appointments.',
      'outcome_description', 'Your visitors get instant answers and can book a call any time. Qualified leads land straight in your calendar, 24/7.'
    )
  )
where name ilike '%concierge%' or name ilike '%buchungsassistent%';
