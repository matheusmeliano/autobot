-- Materializa schedules faltantes para cobranças já cadastradas e atualiza os
-- templates automáticos dos schedules abertos com base no serviço do cliente.

with normalized_templates as (
  select
    mt.id,
    mt.nome,
    mt.created_at,
    regexp_replace(lower(coalesce(mt.nome, '')), '[^a-z0-9]+', ' ', 'g') as normalized_name,
    regexp_replace(lower(coalesce(mt.nome, '')), '[^a-z0-9]+', ' ', 'g') ~ '(atras|vencid|overdue)' as is_overdue
  from message_templates mt
),
generic_pending as (
  select id, nome
  from normalized_templates
  where not is_overdue
  order by
    case when normalized_name ~ '(pendente|inicial|primeira)' then 0 else 1 end,
    created_at asc,
    id asc
  limit 1
),
generic_overdue as (
  select id, nome
  from normalized_templates
  where is_overdue
  order by created_at asc, id asc
  limit 1
),
debtor_template_candidates as (
  select
    d.id as debtor_id,
    t.id as template_id,
    regexp_replace(lower(coalesce(d.observacoes, d.nome, '')), '[^a-z0-9]+', ' ', 'g') as debtor_hint,
    t.normalized_name,
    t.created_at,
    (
      case
        when regexp_replace(lower(coalesce(d.observacoes, d.nome, '')), '[^a-z0-9]+', ' ', 'g') <> ''
          and (
            regexp_replace(lower(coalesce(d.observacoes, d.nome, '')), '[^a-z0-9]+', ' ', 'g') like '%' || t.normalized_name || '%'
            or t.normalized_name like '%' || regexp_replace(lower(coalesce(d.observacoes, d.nome, '')), '[^a-z0-9]+', ' ', 'g') || '%'
          )
        then 1000
        else 0
      end
    ) +
    (
      select count(*)::int * 100
      from (
        select distinct regexp_replace(token, 's$', '') as token
        from regexp_split_to_table(regexp_replace(lower(coalesce(d.observacoes, d.nome, '')), '[^a-z0-9]+', ' ', 'g'), '\s+') as token
        where char_length(token) >= 3
          and token not in ('de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com')
      ) debtor_tokens
      join (
        select distinct regexp_replace(token, 's$', '') as token
        from regexp_split_to_table(t.normalized_name, '\s+') as token
        where char_length(token) >= 3
          and token not in ('de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com')
      ) template_tokens using (token)
    ) as match_score
  from debtors d
  join normalized_templates t
    on not t.is_overdue
),
debtor_pending_templates as (
  select distinct on (debtor_id)
    debtor_id,
    template_id
  from debtor_template_candidates
  where match_score > 0
  order by debtor_id, match_score desc, created_at asc, template_id asc
),
resolved_templates as (
  select
    d.id as debtor_id,
    coalesce(dp.template_id, gp.id) as pending_id,
    coalesce(go.id, gp.id, dp.template_id) as overdue_id
  from debtors d
  left join debtor_pending_templates dp
    on dp.debtor_id = d.id
  cross join generic_pending gp
  left join generic_overdue go
    on true
),
open_charge_schedules as (
  select
    s.id,
    s.charge_id
  from schedules s
  where s.closed_at is null
    and s.charge_id is not null
),
missing_charge_schedules as (
  select
    c.id as charge_id,
    c.debtor_id,
    d.user_id,
    c.due_day,
    c.recurrence_month,
    c.recurrence_year,
    case
      when coalesce(d.retry_time, '') ~ '^\d{2}:\d{2}$' then d.retry_time
      else '09:00'
    end as retry_time,
    least(
      greatest(c.due_day, 1),
      extract(
        day from (
          date_trunc('month', make_date(c.recurrence_year, c.recurrence_month, 1) + interval '1 month')
          - interval '1 day'
        )
      )::int
    ) as safe_day
  from debtor_charges c
  join debtors d
    on d.id = c.debtor_id
  left join open_charge_schedules s
    on s.charge_id = c.id
  where s.id is null
),
missing_charge_schedule_rows as (
  select
    m.charge_id,
    m.debtor_id,
    m.user_id,
    m.due_day,
    m.retry_time,
    make_timestamptz(
      m.recurrence_year,
      m.recurrence_month,
      m.safe_day,
      split_part(m.retry_time, ':', 1)::int,
      split_part(m.retry_time, ':', 2)::int,
      0,
      'America/Sao_Paulo'
    ) as charge_due_at
  from missing_charge_schedules m
)
update schedules s
set
  template_id = rt.pending_id,
  template_pending_id = rt.pending_id,
  template_overdue_id = rt.overdue_id
from debtor_charges c
join resolved_templates rt
  on rt.debtor_id = c.debtor_id
where s.charge_id = c.id
  and s.closed_at is null
  and (
    s.template_id is distinct from rt.pending_id
    or s.template_pending_id is distinct from rt.pending_id
    or s.template_overdue_id is distinct from rt.overdue_id
  );

with normalized_templates as (
  select
    mt.id,
    mt.nome,
    mt.created_at,
    regexp_replace(lower(coalesce(mt.nome, '')), '[^a-z0-9]+', ' ', 'g') as normalized_name,
    regexp_replace(lower(coalesce(mt.nome, '')), '[^a-z0-9]+', ' ', 'g') ~ '(atras|vencid|overdue)' as is_overdue
  from message_templates mt
),
generic_pending as (
  select id, nome
  from normalized_templates
  where not is_overdue
  order by
    case when normalized_name ~ '(pendente|inicial|primeira)' then 0 else 1 end,
    created_at asc,
    id asc
  limit 1
),
generic_overdue as (
  select id, nome
  from normalized_templates
  where is_overdue
  order by created_at asc, id asc
  limit 1
),
debtor_template_candidates as (
  select
    d.id as debtor_id,
    t.id as template_id,
    regexp_replace(lower(coalesce(d.observacoes, d.nome, '')), '[^a-z0-9]+', ' ', 'g') as debtor_hint,
    t.normalized_name,
    t.created_at,
    (
      case
        when regexp_replace(lower(coalesce(d.observacoes, d.nome, '')), '[^a-z0-9]+', ' ', 'g') <> ''
          and (
            regexp_replace(lower(coalesce(d.observacoes, d.nome, '')), '[^a-z0-9]+', ' ', 'g') like '%' || t.normalized_name || '%'
            or t.normalized_name like '%' || regexp_replace(lower(coalesce(d.observacoes, d.nome, '')), '[^a-z0-9]+', ' ', 'g') || '%'
          )
        then 1000
        else 0
      end
    ) +
    (
      select count(*)::int * 100
      from (
        select distinct regexp_replace(token, 's$', '') as token
        from regexp_split_to_table(regexp_replace(lower(coalesce(d.observacoes, d.nome, '')), '[^a-z0-9]+', ' ', 'g'), '\s+') as token
        where char_length(token) >= 3
          and token not in ('de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com')
      ) debtor_tokens
      join (
        select distinct regexp_replace(token, 's$', '') as token
        from regexp_split_to_table(t.normalized_name, '\s+') as token
        where char_length(token) >= 3
          and token not in ('de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com')
      ) template_tokens using (token)
    ) as match_score
  from debtors d
  join normalized_templates t
    on not t.is_overdue
),
debtor_pending_templates as (
  select distinct on (debtor_id)
    debtor_id,
    template_id
  from debtor_template_candidates
  where match_score > 0
  order by debtor_id, match_score desc, created_at asc, template_id asc
),
resolved_templates as (
  select
    d.id as debtor_id,
    coalesce(dp.template_id, gp.id) as pending_id,
    coalesce(go.id, gp.id, dp.template_id) as overdue_id
  from debtors d
  left join debtor_pending_templates dp
    on dp.debtor_id = d.id
  cross join generic_pending gp
  left join generic_overdue go
    on true
),
open_charge_schedules as (
  select
    s.id,
    s.charge_id
  from schedules s
  where s.closed_at is null
    and s.charge_id is not null
),
missing_charge_schedules as (
  select
    c.id as charge_id,
    c.debtor_id,
    d.user_id,
    c.due_day,
    c.recurrence_month,
    c.recurrence_year,
    case
      when coalesce(d.retry_time, '') ~ '^\d{2}:\d{2}$' then d.retry_time
      else '09:00'
    end as retry_time,
    least(
      greatest(c.due_day, 1),
      extract(
        day from (
          date_trunc('month', make_date(c.recurrence_year, c.recurrence_month, 1) + interval '1 month')
          - interval '1 day'
        )
      )::int
    ) as safe_day
  from debtor_charges c
  join debtors d
    on d.id = c.debtor_id
  left join open_charge_schedules s
    on s.charge_id = c.id
  where s.id is null
),
missing_charge_schedule_rows as (
  select
    m.charge_id,
    m.debtor_id,
    m.user_id,
    m.due_day,
    m.retry_time,
    make_timestamptz(
      m.recurrence_year,
      m.recurrence_month,
      m.safe_day,
      split_part(m.retry_time, ':', 1)::int,
      split_part(m.retry_time, ':', 2)::int,
      0,
      'America/Sao_Paulo'
    ) as charge_due_at
  from missing_charge_schedules m
)
insert into schedules (
  user_id,
  debtor_id,
  charge_id,
  template_id,
  template_pending_id,
  template_overdue_id,
  data_envio,
  charge_due_at,
  recurrence,
  schedule_timezone,
  recurrence_day,
  recurrence_time,
  recurrence_until,
  status
)
select
  m.user_id,
  m.debtor_id,
  m.charge_id,
  rt.pending_id,
  rt.pending_id,
  rt.overdue_id,
  case
    when (timezone('America/Sao_Paulo', now()))::date >= (timezone('America/Sao_Paulo', m.charge_due_at))::date
      then greatest(m.charge_due_at, now())
    else m.charge_due_at
  end as data_envio,
  m.charge_due_at,
  'monthly',
  'America/Sao_Paulo',
  m.due_day,
  m.retry_time,
  null,
  case
    when (timezone('America/Sao_Paulo', now()))::date - (timezone('America/Sao_Paulo', m.charge_due_at))::date >= 3
      then 'atrasado'
    else 'agendado'
  end as status
from missing_charge_schedule_rows m
join resolved_templates rt
  on rt.debtor_id = m.debtor_id
where rt.pending_id is not null
  and rt.overdue_id is not null
  and not exists (
    select 1
    from schedules s
    where s.charge_id = m.charge_id
      and s.closed_at is null
  );
