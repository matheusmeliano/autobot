with target_debtors as (
  select id, user_id, vencimento, valor
  from debtors
  where nome in (
    'Pedro Rodrigues',
    'Eduardo Auto Mecânica',
    'Via Visuali Magazine',
    'Exalar Saúde e Bem Estar',
    'Loivo (Marketing Digital)',
    'Loivo (Landing Page + Sistema)',
    'Pastelaria Chinesa Massa',
    'Jorge Hair'
  )
),
reference_month as (
  select extract(year from current_date)::int as year, extract(month from current_date)::int as month
),
existing_reference_charges as (
  select c.*
  from debtor_charges c
  join target_debtors d on d.id = c.debtor_id
  join reference_month r on r.year = c.recurrence_year and r.month = c.recurrence_month
),
fallback_charge_template as (
  select distinct on (c.debtor_id)
    c.debtor_id,
    c.due_day,
    c.amount
  from debtor_charges c
  join target_debtors d on d.id = c.debtor_id
  order by c.debtor_id, c.created_at desc, c.id desc
),
missing_reference_debtors as (
  select d.id as debtor_id, d.user_id, d.vencimento, d.valor
  from target_debtors d
  where not exists (
    select 1 from existing_reference_charges c where c.debtor_id = d.id
  )
),
inserted_reference_charges as (
  insert into debtor_charges (user_id, debtor_id, amount, due_day, recurrence_unit, recurrence_month, recurrence_year)
  select
    m.user_id,
    m.debtor_id,
    coalesce(t.amount, m.valor, 0)::numeric(12,2) as amount,
    greatest(
      1,
      least(
        31,
        coalesce(t.due_day, extract(day from m.vencimento)::int, 1)
      )
    ) as due_day,
    'monthly'::text as recurrence_unit,
    r.month,
    r.year
  from missing_reference_debtors m
  cross join reference_month r
  left join fallback_charge_template t on t.debtor_id = m.debtor_id
  returning *
),
all_reference_charges as (
  select * from existing_reference_charges
  union all
  select * from inserted_reference_charges
),
reference_charges_with_due_at as (
  select
    c.id as charge_id,
    c.debtor_id,
    c.user_id,
    c.due_day,
    c.recurrence_month,
    c.recurrence_year,
    least(
      greatest(c.due_day, 1),
      extract(
        day from (
          date_trunc('month', make_date(c.recurrence_year, c.recurrence_month, 1) + interval '1 month')
          - interval '1 day'
        )
      )::int
    ) as safe_day
  from all_reference_charges c
),
mark_existing_schedules_paid as (
  update schedules s
  set
    status = 'pago',
    payment_received_at = coalesce(s.payment_received_at, now()),
    closed_at = coalesce(s.closed_at, now())
  where s.charge_id in (select charge_id from reference_charges_with_due_at)
  returning s.id
)
insert into schedules (
  user_id,
  debtor_id,
  charge_id,
  status,
  recurrence,
  schedule_timezone,
  data_envio,
  charge_due_at,
  payment_received_at,
  closed_at
)
select
  c.user_id,
  c.debtor_id,
  c.charge_id,
  'pago'::text,
  'monthly'::text,
  'America/Sao_Paulo'::text,
  now(),
  make_timestamptz(
    c.recurrence_year,
    c.recurrence_month,
    c.safe_day,
    9,
    0,
    0,
    'America/Sao_Paulo'
  ),
  now(),
  now()
from reference_charges_with_due_at c
where not exists (
  select 1 from schedules s where s.charge_id = c.charge_id
)
on conflict (user_id, charge_id) where charge_id is not null
do update set
  status = excluded.status,
  payment_received_at = coalesce(schedules.payment_received_at, excluded.payment_received_at),
  closed_at = coalesce(schedules.closed_at, excluded.closed_at);
