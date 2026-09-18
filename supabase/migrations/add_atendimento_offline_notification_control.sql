begin;

alter table public.atendimento_conversations
  add column if not exists offline_message_notification_sent boolean not null default false,
  add column if not exists offline_message_notification_sent_at timestamptz;

create table if not exists public.atendimento_presence_sessions (
  id text primary key,
  conversation_id uuid not null references public.atendimento_conversations(id) on delete cascade,
  lead_id uuid not null references public.atendimento_leads(id) on delete cascade,
  public_slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists atendimento_presence_sessions_conversation_idx
  on public.atendimento_presence_sessions (conversation_id, updated_at desc);

create index if not exists atendimento_presence_sessions_lead_idx
  on public.atendimento_presence_sessions (lead_id, updated_at desc);

alter table public.atendimento_presence_sessions enable row level security;

commit;
