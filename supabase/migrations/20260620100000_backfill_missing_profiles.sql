-- Accounts created before the on_auth_user_created trigger (see
-- 20260620000000_create_profile_on_signup.sql) was deployed have no
-- profiles row. Any checkout attempt for such an account fails with a
-- foreign key violation on automation_requests.customer_id, since that
-- column references profiles(id), not auth.users(id) directly.
--
-- This backfills exactly those orphaned accounts, using the same logic
-- as the trigger. It only inserts rows that are missing, so it's safe
-- to run again (e.g. if new orphans appear from some other gap).
insert into public.profiles (id, email, company_name)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'company_name', '')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
