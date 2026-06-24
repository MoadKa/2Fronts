-- AI Booking Concierge runtime (#23, epic #22).
--
-- The concierge is a public chat page where a coach's audience talks to an AI
-- that answers ONLY from the coach's own content and books a call. Three tables:
--   concierges               -- one per coach: offer, q&a, tone, language, calendar
--   concierge_conversations  -- one per visitor chat session, with an outcome
--   concierge_messages       -- the turns of each conversation
--
-- TRUST POSTURE (the core of the product): offer_description / qa are the
-- coach's private knowledge base. They must NEVER reach the browser. So there is
-- NO anon/authenticated SELECT on any of these tables. The public chat page
-- reads the concierge server-side via the concierge-chat edge function (admin
-- client, bypasses RLS) and only the AI's reply + the calendar link come back.
-- The OWNER can CRUD their own concierges (owner_id = auth.uid()).

-- 1. concierges ----------------------------------------------------------------
create table concierges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null unique,                  -- public URL: /c/<slug>
  business_name text not null,
  offer_description text not null,
  qa text not null default '',
  tone text not null default 'friendly',
  language text not null default 'de',        -- language the AI speaks: 'de' | 'en'
  calendar_url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index concierges_owner_id_idx on concierges (owner_id);
create index concierges_slug_idx on concierges (slug);

-- 2. concierge_conversations --------------------------------------------------
create table concierge_conversations (
  id uuid primary key default gen_random_uuid(),
  concierge_id uuid not null references concierges(id) on delete cascade,
  visitor_session_id text not null,
  outcome text not null check (outcome in ('open', 'booking_shown', 'booking_clicked')) default 'open',
  created_at timestamptz not null default now()
);

create index concierge_conversations_concierge_id_idx on concierge_conversations (concierge_id);
create index concierge_conversations_session_idx on concierge_conversations (concierge_id, visitor_session_id);

-- 3. concierge_messages -------------------------------------------------------
create table concierge_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references concierge_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index concierge_messages_conversation_id_idx on concierge_messages (conversation_id, created_at);

-- RLS -------------------------------------------------------------------------
alter table concierges enable row level security;
alter table concierge_conversations enable row level security;
alter table concierge_messages enable row level security;

-- Owner can CRUD their own concierges. NO public/anon read: the coach's offer
-- and q&a are private knowledge, served only through the edge function. Admins
-- can manage everything for support.
create policy "owners manage own concierges" on concierges
  for all using (owner_id = auth.uid() or is_admin()) with check (owner_id = auth.uid() or is_admin());

-- Conversations + messages have NO anon/authenticated policy at all: the public
-- chat reads and writes them ONLY via the admin client in concierge-chat. Even
-- the owner does not read raw conversations from the browser in this issue
-- (analytics is a later concern); admins can for support.
create policy "admins manage concierge conversations" on concierge_conversations
  for all using (is_admin()) with check (is_admin());
create policy "admins manage concierge messages" on concierge_messages
  for all using (is_admin()) with check (is_admin());
