create table if not exists public.atendimento_daily_summary_runs (
  summary_date date primary key,
  leads_count integer not null default 0,
  timezone text not null default 'America/Cuiaba',
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.atendimento_daily_summary_runs enable row level security;

grant select, insert, update, delete on public.atendimento_daily_summary_runs to authenticated;

drop policy if exists atendimento_daily_summary_runs_authenticated_only on public.atendimento_daily_summary_runs;
create policy atendimento_daily_summary_runs_authenticated_only
  on public.atendimento_daily_summary_runs
  for all
  to authenticated
  using (true)
  with check (true);
