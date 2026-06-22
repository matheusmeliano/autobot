alter table public.debtors
  add column if not exists skip_weekends_on_first_charge boolean not null default false;
