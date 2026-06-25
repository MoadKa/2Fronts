-- Concierge conversations: one row per (concierge_id, visitor_session_id).
--
-- The concierge-chat runtime opens/finds a visitor's conversation with a
-- SELECT-then-INSERT. With no unique constraint, two near-simultaneous messages
-- on the same (concierge_id, visitor_session_id) both miss the SELECT and each
-- INSERT, creating DUPLICATE conversations -- the visitor's history then splits
-- across rows. We add a UNIQUE constraint so the runtime can switch to a
-- race-safe upsert (INSERT ... ON CONFLICT) and always land on one conversation.
--
-- A UNIQUE constraint fails to create if duplicates already exist, so we first
-- dedupe: for each (concierge_id, visitor_session_id) keep the EARLIEST row
-- (min created_at, tie-break min id) and delete the rest. Deleted conversations'
-- concierge_messages cascade away via the ON DELETE CASCADE fk.

-- 1. Dedupe: delete all but the earliest row per (concierge_id, visitor_session_id).
delete from concierge_conversations c
using (
  select id,
         row_number() over (
           partition by concierge_id, visitor_session_id
           order by created_at asc, id asc
         ) as rn
  from concierge_conversations
) ranked
where c.id = ranked.id
  and ranked.rn > 1;

-- 2. Drop the now-redundant non-unique lookup index. The unique constraint
--    below creates its own index covering the same (concierge_id,
--    visitor_session_id) lookup.
drop index if exists concierge_conversations_session_idx;

-- 3. Add the unique constraint that makes the runtime upsert race-safe.
alter table concierge_conversations
  add constraint concierge_conversations_concierge_session_key
  unique (concierge_id, visitor_session_id);
