-- Coach chat dashboard: let a concierge OWNER read (only) their own concierge's
-- conversations and messages, so the authed app can show all chats happening on
-- their link. Writes still happen exclusively through the admin client in the
-- public concierge-chat edge function; these policies are SELECT-only and never
-- expose another owner's data (scoped by concierges.owner_id = auth.uid()).
-- The visitor's offer/qa knowledge is on the concierges row, not here, so this
-- only surfaces the visitor-facing transcript + qualification outcome.

create policy "owners read own concierge conversations" on concierge_conversations
  for select using (
    exists (
      select 1 from concierges c
      where c.id = concierge_conversations.concierge_id
        and c.owner_id = auth.uid()
    )
  );

create policy "owners read own concierge messages" on concierge_messages
  for select using (
    exists (
      select 1
      from concierge_conversations conv
      join concierges c on c.id = conv.concierge_id
      where conv.id = concierge_messages.conversation_id
        and c.owner_id = auth.uid()
    )
  );
