with target_debtors as (
  select id
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
  select extract(year from now())::int as year, extract(month from now())::int as month
),
target_charges as (
  select c.id, c.debtor_id, c.due_day, c.recurrence_month, c.recurrence_year, c.created_at
  from debtor_charges c
  join target_debtors d on d.id = c.debtor_id
  join reference_month r on r.year = c.recurrence_year and r.month = c.recurrence_month
),
backfill_charge_id as (
  update schedules s
  set charge_id = tc.id
  from target_charges tc
  where s.debtor_id = tc.debtor_id
    and s.charge_id is null
    and extract(day from coalesce(s.charge_due_at, s.data_envio::timestamptz))::int = tc.due_day
    and extract(month from coalesce(s.charge_due_at, s.data_envio::timestamptz))::int = tc.recurrence_month
    and extract(year from coalesce(s.charge_due_at, s.data_envio::timestamptz))::int = tc.recurrence_year
  returning s.id
)
update schedules s
set
  status = 'pago',
  payment_received_at = coalesce(s.payment_received_at, now()),
  closed_at = coalesce(s.closed_at, now())
where s.charge_id in (select id from target_charges);
