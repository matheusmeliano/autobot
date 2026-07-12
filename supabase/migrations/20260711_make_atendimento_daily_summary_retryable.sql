alter table public.atendimento_daily_summary_runs
  alter column sent_at drop not null,
  alter column sent_at drop default;

alter table public.atendimento_daily_summary_runs
  add column if not exists last_attempt_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text;

update public.atendimento_daily_summary_runs
set
  attempt_count = case
    when coalesce(attempt_count, 0) > 0 then attempt_count
    else 1
  end,
  last_attempt_at = coalesce(last_attempt_at, sent_at, created_at);
