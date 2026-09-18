alter table public.debtors
add column if not exists accumulate_open_monthly_charges boolean not null default false;
