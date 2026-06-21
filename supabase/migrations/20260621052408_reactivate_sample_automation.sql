-- Correction to 20260621051627: the prior migration assumed the original
-- seed row ("Invoice Sync", created 20260619000000) had been deleted, since
-- an anon REST query returned zero rows. It had not been deleted — it was
-- deactivated (is_active = false), which RLS correctly hides from anon
-- reads ("anyone reads active automations" policy), making the deactivated
-- row indistinguishable from an empty table via the public API. The prior
-- migration's `where not exists` guard correctly no-op'd against the
-- existing row. This reactivates it so the public catalog isn't empty.
update automations
set is_active = true
where name = 'Invoice Sync';
