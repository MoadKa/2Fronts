drop policy "users insert own profile" on profiles;

create policy "users insert own profile" on profiles
  for insert with check (id = auth.uid() and role = 'customer');
