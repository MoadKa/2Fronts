-- The "users update own profile" policy only constrains which ROW a user
-- may update (id = auth.uid()); it has no `with check`, so Postgres reuses
-- the `using` clause as the check clause, which still only constrains the
-- row, not the columns being written. That means a non-admin customer can
-- run `update profiles set role = 'admin' where id = auth.uid()` and the
-- existing UPDATE policy permits it -- the same privilege-escalation class
-- already closed on INSERT in 20260618010000_restrict_profile_role_insert.sql,
-- reachable here via UPDATE instead.
--
-- RLS policies cannot express "this column may only change if X" on their
-- own, so we enforce it with a BEFORE UPDATE trigger: if the incoming role
-- differs from the stored role and the calling user is not currently an
-- admin, the trigger resets NEW.role back to OLD.role before the row is
-- written. All other column changes in the same statement still go through
-- untouched. Because the trigger fires BEFORE the write, is_admin() still
-- sees the caller's pre-update role, so it correctly reflects whether they
-- already held admin privileges prior to this statement.
create function prevent_role_self_escalation() returns trigger as $$
begin
  if new.role is distinct from old.role and not is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger profiles_prevent_role_escalation
  before update on profiles
  for each row
  execute function prevent_role_self_escalation();
