-- Realinha schedules abertas com charge_id às datas atuais da cobrança quando a
-- cobrança ainda está no futuro e o schedule ficou preso a um ciclo anterior.

with expected_future_schedules as (
  select
    s.id as schedule_id,
    s.status as current_status,
    s.data_envio as current_data_envio,
    s.charge_due_at as current_charge_due_at,
    d.retry_time,
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
      split_part(coalesce(nullif(d.retry_time, ''), '09:00'), ':', 1)::int,
      split_part(coalesce(nullif(d.retry_time, ''), '09:00'), ':', 2)::int,
      0,
      'America/Sao_Paulo'
    ) as expected_due_at
  from schedules s
  join debtor_charges c
    on c.id = s.charge_id
  join debtors d
    on d.id = s.debtor_id
  where s.closed_at is null
    and s.charge_id is not null
    and s.payment_received_at is null
),
future_mismatches as (
  select
    e.schedule_id,
    e.expected_due_at,
    coalesce(nullif(e.retry_time, ''), '09:00') as expected_retry_time,
    e.due_day
  from expected_future_schedules e
  where e.expected_due_at > now()
    and (
      e.current_charge_due_at is distinct from e.expected_due_at
      or e.current_data_envio is distinct from e.expected_due_at
      or coalesce(e.current_status, '') <> 'agendado'
    )
)
update schedules s
set
  data_envio = f.expected_due_at,
  charge_due_at = f.expected_due_at,
  recurrence_day = f.due_day,
  recurrence_time = f.expected_retry_time,
  status = 'agendado',
  first_sent_at = null,
  last_sent_at = null,
  retry_attempts = 0,
  payment_received_at = null,
  closed_at = null
from future_mismatches f
where s.id = f.schedule_id;
