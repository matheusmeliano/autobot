update public.debtors
set retry_interval_days = 1
where retry_interval_days is distinct from 1;

alter table public.debtors
  alter column retry_interval_days set default 1;
