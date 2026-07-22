-- Conversation phase for the concierge question-gate flow.
--
-- The public concierge now runs a controlled flow: capture contact, ask whether
-- the visitor has questions (answer them in a loop), run qualification, ask once
-- more before the booking link, then book. The current step is tracked here so
-- the stateless edge function (concierge-chat) can resume the right step on each
-- turn instead of re-deriving it from partial signals.
--
-- Values: 'contact' | 'intro_gate' | 'answering_intro' | 'qualifying'
--         | 'final_gate' | 'answering_final' | 'booking'
-- Older rows (and every new conversation) default to 'contact', so the flow
-- always starts by capturing the name + email. No GRANT: this table has no
-- anon/authenticated policy and is read/written only by the admin client in the
-- edge function, exactly like the other columns on it.
alter table concierge_conversations
  add column if not exists phase text not null default 'contact';
