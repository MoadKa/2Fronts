-- Rate limiting for the public, no-JWT concierge-chat endpoint (CSO finding #1).
-- The endpoint calls Gemini on every message; without a cap a script can run up
-- the LLM bill. Edge isolates are stateless, so the counter lives in Postgres and
-- is enforced atomically by a SECURITY DEFINER function the service role calls.

create table if not exists public.concierge_rate_limits (
  bucket_key   text primary key,
  window_start timestamptz not null default now(),
  count        integer     not null default 0
);

-- Service-role only: no anon/authenticated access. RLS on with zero policies
-- denies everyone except the service key the edge function uses.
alter table public.concierge_rate_limits enable row level security;

-- Fixed-window counter. Returns TRUE when the request is allowed (count within
-- p_max for the current window), FALSE when it should be rejected (429). The
-- upsert is atomic, so concurrent isolates can't race past the limit.
create or replace function public.concierge_rate_limit_hit(
  p_key text,
  p_max integer,
  p_window_secs integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.concierge_rate_limits as r (bucket_key, window_start, count)
  values (p_key, now(), 1)
  on conflict (bucket_key) do update
    set count = case
                  when r.window_start < now() - make_interval(secs => p_window_secs) then 1
                  else r.count + 1
                end,
        window_start = case
                  when r.window_start < now() - make_interval(secs => p_window_secs) then now()
                  else r.window_start
                end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;
