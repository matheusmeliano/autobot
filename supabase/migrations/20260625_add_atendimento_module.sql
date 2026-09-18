create table if not exists public.atendimento_public_links (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null default 'Link principal de atendimento',
  active boolean not null default true,
  assigned_user_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.atendimento_leads (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  phone text,
  cpf text,
  email text,
  city text,
  state text,
  country text,
  timezone text,
  best_contact_time text,
  origin text not null default 'link_publico_atendimento',
  status text not null default 'novo_lead',
  funnel_stage text not null default 'novo_lead',
  assigned_user_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_interaction_at timestamptz,
  unread_count integer not null default 0
);

create table if not exists public.atendimento_conversations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null,
  public_link_id uuid,
  channel text not null default 'web',
  public_slug text not null unique,
  bot_enabled boolean not null default true,
  last_message_preview text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.atendimento_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  sender_role text not null,
  content_text text,
  media_type text not null default 'text',
  media_url text,
  mime_type text,
  external_message_id text,
  status text not null default 'enviada',
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.atendimento_history_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null,
  conversation_id uuid,
  event_type text not null,
  title text not null,
  details jsonb,
  actor_type text not null,
  actor_email text,
  created_at timestamptz not null default now()
);

create table if not exists public.atendimento_captured_fields (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null,
  field_name text not null,
  field_value text,
  source_message_id text,
  confidence numeric(4,3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists atendimento_leads_phone_idx
  on public.atendimento_leads (phone);

create index if not exists atendimento_leads_status_idx
  on public.atendimento_leads (status, funnel_stage);

create index if not exists atendimento_leads_last_interaction_idx
  on public.atendimento_leads (last_interaction_at desc nulls last);

create index if not exists atendimento_conversations_lead_idx
  on public.atendimento_conversations (lead_id, updated_at desc);

create index if not exists atendimento_messages_conversation_idx
  on public.atendimento_messages (conversation_id, created_at asc);

create index if not exists atendimento_history_events_lead_idx
  on public.atendimento_history_events (lead_id, created_at desc);

alter table public.atendimento_public_links enable row level security;
alter table public.atendimento_leads enable row level security;
alter table public.atendimento_conversations enable row level security;
alter table public.atendimento_messages enable row level security;
alter table public.atendimento_history_events enable row level security;
alter table public.atendimento_captured_fields enable row level security;

grant select, insert, update, delete on public.atendimento_public_links to authenticated;
grant select, insert, update, delete on public.atendimento_leads to authenticated;
grant select, insert, update, delete on public.atendimento_conversations to authenticated;
grant select, insert, update, delete on public.atendimento_messages to authenticated;
grant select, insert, update, delete on public.atendimento_history_events to authenticated;
grant select, insert, update, delete on public.atendimento_captured_fields to authenticated;

create policy atendimento_public_links_authenticated_only
  on public.atendimento_public_links
  for all
  to authenticated
  using (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com')
  with check (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com');

create policy atendimento_leads_authenticated_only
  on public.atendimento_leads
  for all
  to authenticated
  using (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com')
  with check (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com');

create policy atendimento_conversations_authenticated_only
  on public.atendimento_conversations
  for all
  to authenticated
  using (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com')
  with check (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com');

create policy atendimento_messages_authenticated_only
  on public.atendimento_messages
  for all
  to authenticated
  using (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com')
  with check (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com');

create policy atendimento_history_events_authenticated_only
  on public.atendimento_history_events
  for all
  to authenticated
  using (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com')
  with check (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com');

create policy atendimento_captured_fields_authenticated_only
  on public.atendimento_captured_fields
  for all
  to authenticated
  using (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com')
  with check (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com');

insert into public.atendimento_public_links (slug, label, active, assigned_user_email)
select 'lucas-brum-online-music-usa', 'Link principal de atendimento', true, 'atendimento.usa.music@gmail.com'
where not exists (
  select 1
  from public.atendimento_public_links
  where slug = 'lucas-brum-online-music-usa'
);
