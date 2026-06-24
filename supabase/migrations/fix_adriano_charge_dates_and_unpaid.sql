with target_debtor as (
  select id, user_id
  from debtors
  where nome = 'Adriano Construtor'
  limit 1
),
june_charge as (
  select c.id
  from debtor_charges c
  join target_debtor d on d.id = c.debtor_id
  where c.recurrence_year = 2026
    and c.recurrence_month = 6
  order by c.created_at asc
  limit 1
),
july_charge as (
  select c.id
  from debtor_charges c
  join target_debtor d on d.id = c.debtor_id
  where c.recurrence_year = 2026
    and c.recurrence_month = 7
  order by c.created_at asc
  limit 1
),
fix_june_charge as (
  update debtor_charges c
  set due_day = 26
  where c.id in (select id from june_charge)
  returning c.id
),
fix_july_charge as (
  update debtor_charges c
  set due_day = 10
  where c.id in (select id from july_charge)
  returning c.id
),
fix_june_schedule as (
  update schedules s
  set
    status = 'agendado',
    data_envio = make_timestamptz(2026, 6, 26, 9, 0, 0, 'America/Sao_Paulo'),
    charge_due_at = make_timestamptz(2026, 6, 26, 9, 0, 0, 'America/Sao_Paulo'),
    payment_received_at = null,
    closed_at = null
  where s.charge_id in (select id from june_charge)
  returning s.id
),
fix_july_schedule as (
  update schedules s
  set
    status = 'agendado',
    data_envio = make_timestamptz(2026, 7, 10, 9, 0, 0, 'America/Sao_Paulo'),
    charge_due_at = make_timestamptz(2026, 7, 10, 9, 0, 0, 'America/Sao_Paulo'),
    payment_received_at = null,
    closed_at = null
  where s.charge_id in (select id from july_charge)
  returning s.id
)
update schedules s
set
  status = 'agendado',
  payment_received_at = null,
  closed_at = now()
from target_debtor d
where s.debtor_id = d.id
  and s.charge_id is null
  and lower(coalesce(s.status, '')) = 'pago';
