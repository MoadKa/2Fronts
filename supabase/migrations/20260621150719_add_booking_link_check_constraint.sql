-- booking_link is customer-entered (AutomationDetailPage.tsx) and is echoed
-- verbatim into automated SMS sent to third parties (the customer's
-- missed-call leads) via twilio-voice-webhook. The app only checked
-- non-empty client-side; RLS only checks row ownership, not content, so a
-- request crafted directly against the REST API (bypassing the React form
-- entirely) could put arbitrary text -- including a phishing URL or an
-- oversized string -- into a message sent under this platform's Twilio
-- number. This constraint is the actual enforcement boundary, not a
-- convenience check.
alter table automation_provisions
  add constraint booking_link_well_formed
  check (booking_link ~ '^https?://' and length(booking_link) <= 200);
