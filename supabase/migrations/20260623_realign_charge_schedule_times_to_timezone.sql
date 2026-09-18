-- Corrige schedules automáticas abertas que ficaram com timestamps de um fuso
-- antigo, mesmo já estando marcadas com outro schedule_timezone.

with schedule_expectations as (
  select
    s.id as schedule_id,
    coalesce(nullif(s.schedule_timezone, ''), nullif(p.timezone, ''), 'America/Sao_Paulo') as effective_timezone,
    coalesce(nullif(d.retry_time, ''), nullif(s.recurrence_time, ''), '09:00') as expected_retry_time,
    c.due_day,
    make_timestamptz(
      c.recurrence_year,
      c.recurrence_month,
      least(
        greatest(c.due_day, 1),
        extract(
          day from (
            date_trunc('month', make_date(c.recurrence_year, c.recurrence_month, 1) + interval '1 month')
            - interval '1 day'
          )
        )::int
      ),
      split_part(coalesce(nullif(d.retry_time, ''), nullif(s.recurrence_time, ''), '09:00'), ':', 1)::int,
      split_part(coalesce(nullif(d.retry_time, ''), nullif(s.recurrence_time, ''), '09:00'), ':', 2)::int,
      0,
      coalesce(nullif(s.schedule_timezone, ''), nullif(p.timezone, ''), 'America/Sao_Paulo')
    ) as expected_due_at
  from schedules s
  join debtors d
    on d.id = s.debtor_id
  join debtor_charges c
    on c.id = s.charge_id
  left join profiles p
    on p.user_id = d.user_id
  where s.closed_at is null
    and s.charge_id is not null
    and coalesce(s.status, '') = 'agendado'
    and s.payment_received_at is null
),
schedule_mismatches as (
  select
    e.schedule_id,
    e.effective_timezone,
    e.expected_retry_time,
    e.expected_due_at,
    e.due_day
  from schedule_expectations e
  join schedules s
    on s.id = e.schedule_id
  where s.charge_due_at is distinct from e.expected_due_at
    or s.data_envio is distinct from e.expected_due_at
    or coalesce(nullif(s.recurrence_time, ''), '') <> e.expected_retry_time
    or coalesce(nullif(s.schedule_timezone, ''), '') <> e.effective_timezone
)
update schedules s
set
  schedule_timezone = m.effective_timezone,
  recurrence_time = m.expected_retry_time,
  recurrence_day = m.due_day,
  charge_due_at = m.expected_due_at,
  data_envio = m.expected_due_at
from schedule_mismatches m
where s.id = m.schedule_id;
