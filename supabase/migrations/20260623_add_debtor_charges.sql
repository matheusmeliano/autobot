create table if not exists debtor_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  debtor_id uuid not null references debtors(id) on delete cascade,
  amount numeric(12,2) not null,
  due_day int not null,
  created_at timestamptz not null default now(),
  constraint debtor_charges_due_day_check check (due_day >= 1 and due_day <= 31)
);

create index if not exists idx_debtor_charges_user_id on debtor_charges(user_id);
create index if not exists idx_debtor_charges_debtor_id on debtor_charges(debtor_id);

alter table debtor_charges enable row level security;

drop policy if exists "debtor_charges_owner" on debtor_charges;
create policy "debtor_charges_owner"
on debtor_charges for all
to authenticated
using (public.is_owner(user_id))
with check (public.is_owner(user_id));

alter table schedules
  add column if not exists charge_id uuid references debtor_charges(id) on delete set null;

create index if not exists idx_schedules_charge_id on schedules(user_id, charge_id);
create unique index if not exists uniq_schedules_charge_id on schedules(user_id, charge_id) where charge_id is not null;

insert into debtor_charges (user_id, debtor_id, amount, due_day)
select
  d.user_id,
  d.id,
  d.valor,
  extract(day from d.vencimento)::int
from debtors d
where d.valor is not null
  and d.vencimento is not null
  and not exists (
    select 1 from debtor_charges dc
    where dc.debtor_id = d.id
  );
