create table if not exists whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'zapi',
  event_id text not null,
  instance_id text,
  event_type text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_whatsapp_events_provider_event_id on whatsapp_events(provider, event_id);
create index if not exists idx_whatsapp_events_user_id on whatsapp_events(user_id);

create table if not exists payment_suspicions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  schedule_id uuid references schedules(id) on delete set null,
  debtor_id uuid references debtors(id) on delete set null,
  provider text not null default 'zapi',
  event_id text,
  from_phone text,
  message_text text,
  media_url text,
  ai_confidence numeric(4,3),
  ai_reason text,
  ai_result jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists idx_payment_suspicions_provider_event_id on payment_suspicions(provider, event_id);
create index if not exists idx_payment_suspicions_user_status_created_at on payment_suspicions(user_id, status, created_at desc);
create index if not exists idx_payment_suspicions_schedule_id on payment_suspicions(schedule_id);

alter table whatsapp_events enable row level security;
alter table payment_suspicions enable row level security;

drop policy if exists "whatsapp_events_owner" on whatsapp_events;
create policy "whatsapp_events_owner"
on whatsapp_events for all
to authenticated
using (public.is_owner(user_id))
with check (public.is_owner(user_id));

drop policy if exists "payment_suspicions_owner" on payment_suspicions;
create policy "payment_suspicions_owner"
on payment_suspicions for all
to authenticated
using (public.is_owner(user_id))
with check (public.is_owner(user_id));
