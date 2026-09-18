alter table public.debtors
  add column if not exists retry_weekdays smallint[] not null default array[1,2,3,4,5],
  add column if not exists retry_time text not null default '09:00',
  add column if not exists retry_max_attempts integer not null default 5,
  add column if not exists retry_interval_days integer not null default 1,
  add column if not exists retry_auto_close_days integer not null default 30;

alter table public.schedules
  add column if not exists charge_due_at timestamptz,
  add column if not exists first_sent_at timestamptz,
  add column if not exists last_sent_at timestamptz,
  add column if not exists retry_attempts integer not null default 0,
  add column if not exists payment_received_at timestamptz,
  add column if not exists closed_at timestamptz;

update public.schedules
set charge_due_at = data_envio
where charge_due_at is null;

alter table public.schedules
  alter column charge_due_at set not null;
