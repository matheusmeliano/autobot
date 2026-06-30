alter table public.profiles
  add column if not exists access_scope text not null default 'app';

alter table public.atendimento_leads
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists atendimento_leads_auth_user_id_idx
  on public.atendimento_leads (auth_user_id)
  where auth_user_id is not null;
