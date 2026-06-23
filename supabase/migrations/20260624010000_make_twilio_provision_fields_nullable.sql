-- business_name and booking_link were modeled for the original Twilio missed-call
-- product (the only automation at the time) and marked NOT NULL. Now that an
-- automation can be fulfilled by other connectors (google_sheets,
-- slack_notifications), createProvisionDetails only writes these two fields for
-- connector_type='twilio_missed_call'. Inserting a Google Sheets / Slack
-- provision therefore left them NULL and violated NOT NULL, which surfaced to the
-- buyer as "Checkout konnte nicht gestartet werden" (the insert throws before
-- checkout is even called).
--
-- Make both nullable: they are Twilio-specific. The Twilio path still populates
-- them, and the booking_link_well_formed CHECK still enforces the URL format when
-- a value is present (a CHECK passes for NULL, so non-Twilio rows are unaffected).
alter table automation_provisions alter column business_name drop not null;
alter table automation_provisions alter column booking_link drop not null;
