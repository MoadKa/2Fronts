-- signUp() used to insert the profiles row from the client right after
-- auth.signUp(). That insert depends on having an active session: when
-- Supabase's "Confirm email" setting is on (the default), signUp() returns
-- no session until the user confirms their email, so auth.uid() is null,
-- the "users insert own profile" RLS check (id = auth.uid()) fails, and the
-- error was never checked client-side -- leaving the user with no profiles
-- row at all. Any later insert into automation_requests then fails on the
-- customer_id foreign key, since it has no matching profiles row to point to.
--
-- Creating the profile from a security definer trigger on auth.users runs
-- inside the same transaction as the user's creation, regardless of email
-- confirmation state, so it's immune to the missing-session problem.
create function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, email, company_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'company_name', ''));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();
