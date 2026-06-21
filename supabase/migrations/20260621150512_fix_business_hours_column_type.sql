-- business_hours was declared jsonb in 20260620120000, but every app-layer
-- consumer (src/types/database.ts, RequestService.createProvisionDetails,
-- twilio-voice-webhook's SMS template builder) treats it as a plain string.
-- Dormant until now (the only call site always passes undefined), but the
-- mismatch would break the first real business-hours feature. Safe to
-- convert directly: the column has no non-null data yet in production.
alter table automation_provisions alter column business_hours type text;
