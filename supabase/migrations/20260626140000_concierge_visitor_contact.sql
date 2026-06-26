-- Lead contact capture: the public concierge asks every visitor for their name
-- and email right before showing the booking link, so the coach ALWAYS has a
-- contact person + email for a lead who reaches the booking step. Stored on the
-- conversation (nullable: older rows and visitors who bail before this step have
-- none). Surfaced to the owner in the chat dashboard.
alter table concierge_conversations
  add column if not exists visitor_name text,
  add column if not exists visitor_email text;
