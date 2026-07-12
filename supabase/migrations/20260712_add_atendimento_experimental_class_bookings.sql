create table if not exists public.atendimento_experimental_class_bookings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.atendimento_leads(id) on delete cascade,
  conversation_id uuid not null references public.atendimento_conversations(id) on delete cascade,
  professor_timezone text not null default 'America/Cuiaba',
  lead_timezone text,
  professor_date date not null,
  professor_time text not null,
  professor_start_at timestamptz not null,
  lead_date date,
  lead_time text,
  lead_start_at timestamptz,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists atendimento_experimental_class_bookings_professor_start_unique
  on public.atendimento_experimental_class_bookings (professor_start_at)
  where status = 'scheduled';

create unique index if not exists atendimento_experimental_class_bookings_lead_unique
  on public.atendimento_experimental_class_bookings (lead_id)
  where status = 'scheduled';

create index if not exists atendimento_experimental_class_bookings_conversation_idx
  on public.atendimento_experimental_class_bookings (conversation_id, created_at desc);

alter table public.atendimento_experimental_class_bookings enable row level security;

grant select, insert, update, delete on public.atendimento_experimental_class_bookings to authenticated;

create policy atendimento_experimental_class_bookings_authenticated_only
  on public.atendimento_experimental_class_bookings
  for all
  to authenticated
  using (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com')
  with check (auth.jwt() ->> 'email' = 'atendimento.usa.music@gmail.com');
