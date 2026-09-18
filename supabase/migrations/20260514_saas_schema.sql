create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  nome text,
  email text,
  plano text default 'teste',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() unique references auth.users(id) on delete cascade,
  instance_id text,
  token text,
  status text default 'disconnected',
  phone text,
  created_at timestamptz not null default now()
);
create index if not exists idx_whatsapp_instances_user_id on whatsapp_instances(user_id);

create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  conteudo text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_message_templates_user_id on message_templates(user_id);

create table if not exists debtors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  telefone text,
  valor numeric(12,2),
  vencimento date,
  pix_key text,
  observacoes text,
  status text not null default 'ativo',
  created_at timestamptz not null default now()
);
create index if not exists idx_debtors_user_id on debtors(user_id);
create index if not exists idx_debtors_status on debtors(user_id, status);

create table if not exists charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  debtor_id uuid not null references debtors(id) on delete cascade,
  mensagem text,
  status text not null default 'pendente',
  enviada_em timestamptz,
  tentativa int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_charges_user_id on charges(user_id);
create index if not exists idx_charges_debtor_id on charges(debtor_id);
create index if not exists idx_charges_status on charges(user_id, status);

create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  debtor_id uuid not null references debtors(id) on delete cascade,
  template_id uuid references message_templates(id) on delete set null,
  data_envio timestamptz not null,
  status text not null default 'agendado',
  created_at timestamptz not null default now()
);
create index if not exists idx_schedules_user_id on schedules(user_id);
create index if not exists idx_schedules_data_envio on schedules(user_id, data_envio);

create table if not exists logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo text not null,
  descricao text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_logs_user_id on logs(user_id);
create index if not exists idx_logs_created_at on logs(user_id, created_at desc);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plano text not null default 'teste',
  status text not null default 'ativo',
  vencimento date,
  created_at timestamptz not null default now()
);
create index if not exists idx_subscriptions_user_id on subscriptions(user_id);

alter table profiles enable row level security;
alter table whatsapp_instances enable row level security;
alter table debtors enable row level security;
alter table charges enable row level security;
alter table message_templates enable row level security;
alter table schedules enable row level security;
alter table logs enable row level security;
alter table subscriptions enable row level security;

drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own"
on profiles for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own"
on profiles for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own"
on profiles for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "profiles_delete_own" on profiles;
create policy "profiles_delete_own"
on profiles for delete
to authenticated
using (user_id = auth.uid());

create or replace function public.is_owner(row_user_id uuid)
returns boolean
language sql
stable
as $$
  select row_user_id = auth.uid();
$$;

drop policy if exists "whatsapp_instances_owner" on whatsapp_instances;
create policy "whatsapp_instances_owner"
on whatsapp_instances for all
to authenticated
using (public.is_owner(user_id))
with check (public.is_owner(user_id));

drop policy if exists "message_templates_owner" on message_templates;
create policy "message_templates_owner"
on message_templates for all
to authenticated
using (public.is_owner(user_id))
with check (public.is_owner(user_id));

drop policy if exists "debtors_owner" on debtors;
create policy "debtors_owner"
on debtors for all
to authenticated
using (public.is_owner(user_id))
with check (public.is_owner(user_id));

drop policy if exists "charges_owner" on charges;
create policy "charges_owner"
on charges for all
to authenticated
using (public.is_owner(user_id))
with check (public.is_owner(user_id));

drop policy if exists "schedules_owner" on schedules;
create policy "schedules_owner"
on schedules for all
to authenticated
using (public.is_owner(user_id))
with check (public.is_owner(user_id));

drop policy if exists "logs_owner" on logs;
create policy "logs_owner"
on logs for all
to authenticated
using (public.is_owner(user_id))
with check (public.is_owner(user_id));

drop policy if exists "subscriptions_owner" on subscriptions;
create policy "subscriptions_owner"
on subscriptions for all
to authenticated
using (public.is_owner(user_id))
with check (public.is_owner(user_id));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, nome, plano)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''), 'teste')
  on conflict (user_id) do nothing;
  insert into public.subscriptions (user_id, plano, status, vencimento)
  select new.id, 'teste', 'ativo', (current_date + 7)
  where not exists (select 1 from public.subscriptions s where s.user_id = new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
