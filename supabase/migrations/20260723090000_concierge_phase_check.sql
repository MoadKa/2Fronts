-- Constrain concierge_conversations.phase to its known set of values.
--
-- The phase column (added in 20260722120000) is written only by the concierge
-- edge function, from a closed set of string literals. This CHECK makes that
-- contract explicit at the database level — matching the sibling `outcome`
-- column, which already carries `check (outcome in (...))` — so a future code
-- typo or phase-name drift fails at write time instead of silently storing a
-- value the flow can't interpret.
--
-- Wrapped in a guard so the migration is idempotent (re-runnable): Postgres has
-- no ADD CONSTRAINT IF NOT EXISTS. Every existing row is already in this set
-- (older rows default to 'contact'), so validation passes with no table rewrite.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'concierge_conversations_phase_check'
  ) then
    alter table concierge_conversations
      add constraint concierge_conversations_phase_check
      check (phase in (
        'contact', 'intro_gate', 'answering_intro', 'qualifying',
        'final_gate', 'answering_final', 'booking'
      ));
  end if;
end $$;
