with target_debtor as (
  select id, user_id
  from debtors
  where nome = 'Adriano Construtor'
  limit 1
),
orphan_paid_schedule as (
  select
    s.id,
    s.debtor_id,
    s.data_envio,
    s.charge_due_at,
    extract(day from s.charge_due_at at time zone 'America/Sao_Paulo')::int as due_day,
    extract(month from s.charge_due_at at time zone 'America/Sao_Paulo')::int as recurrence_month,
    extract(year from s.charge_due_at at time zone 'America/Sao_Paulo')::int as recurrence_year,
    coalesce(s.payment_received_at, s.closed_at, now()) as paid_at
  from schedules s
  join target_debtor d on d.id = s.debtor_id
  where s.charge_id is null
    and lower(coalesce(s.status, '')) = 'pago'
    and s.charge_due_at is not null
  order by s.created_at asc
  limit 1
),
matching_charge as (
  select c.id
  from debtor_charges c
  join orphan_paid_schedule ops
    on ops.debtor_id = c.debtor_id
   and ops.recurrence_month = c.recurrence_month
   and ops.recurrence_year = c.recurrence_year
  order by c.created_at asc
  limit 1
),
linked_schedule as (
  select s.id
  from schedules s
  where s.charge_id in (select id from matching_charge)
  order by s.created_at asc
  limit 1
),
fix_charge as (
  update debtor_charges c
  set due_day = ops.due_day
  from orphan_paid_schedule ops
  where c.id in (select id from matching_charge)
  returning c.id
)
update schedules s
set
  status = 'pago',
  data_envio = coalesce(ops.data_envio, s.data_envio),
  charge_due_at = coalesce(ops.charge_due_at, s.charge_due_at),
  payment_received_at = coalesce(s.payment_received_at, ops.paid_at),
  closed_at = coalesce(s.closed_at, ops.paid_at)
from orphan_paid_schedule ops
where s.id in (select id from linked_schedule);
