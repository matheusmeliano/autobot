-- Fecha schedules ativos duplicados para a mesma charge e limpa legados sem charge_id
-- quando já existe um schedule ativo correspondente para a cobrança do cliente.

with ranked_charge_schedules as (
  select
    id,
    row_number() over (
      partition by charge_id
      order by created_at desc nulls last, id desc
    ) as rn
  from schedules
  where charge_id is not null
    and closed_at is null
),
duplicate_charge_schedules as (
  select id
  from ranked_charge_schedules
  where rn > 1
)
update schedules
set closed_at = now()
where id in (select id from duplicate_charge_schedules)
  and closed_at is null;

with canonical_charge_schedules as (
  select
    s.id,
    s.debtor_id,
    s.recurrence_day,
    case
      when s.charge_due_at is null then null
      else (timezone('UTC', s.charge_due_at))::date
    end as charge_due_date
  from schedules s
  where s.closed_at is null
    and s.charge_id is not null
    and s.recurrence in ('monthly', 'yearly')
),
legacy_duplicate_schedules as (
  select distinct s.id
  from schedules s
  join canonical_charge_schedules c
    on c.debtor_id = s.debtor_id
  where s.closed_at is null
    and s.charge_id is null
    and s.recurrence in ('monthly', 'yearly')
    and (
      (s.recurrence_day is not null and c.recurrence_day is not null and s.recurrence_day = c.recurrence_day)
      or (
        s.charge_due_at is not null
        and c.charge_due_date is not null
        and (timezone('UTC', s.charge_due_at))::date = c.charge_due_date
      )
    )
)
update schedules
set closed_at = now()
where id in (select id from legacy_duplicate_schedules)
  and closed_at is null;

create unique index if not exists schedules_one_open_charge_schedule_idx
  on schedules(charge_id)
  where charge_id is not null and closed_at is null;
