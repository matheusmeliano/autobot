begin;

create temp table temp_atendimento_name_repairs on commit drop as
with first_lead_messages as (
  select
    c.lead_id,
    trim(regexp_replace(coalesce(m.content_text, ''), '\s+', ' ', 'g')) as candidate_name,
    row_number() over (
      partition by c.lead_id
      order by m.created_at asc, m.id asc
    ) as rn
  from public.atendimento_conversations c
  join public.atendimento_messages m
    on m.conversation_id = c.id
  where m.sender_role = 'lead'
),
candidate_names as (
  select
    flm.lead_id,
    flm.candidate_name
  from first_lead_messages flm
  where flm.rn = 1
    and flm.candidate_name <> ''
    and flm.candidate_name !~ '[0-9]'
    and flm.candidate_name !~* '[@/:\\]'
    and flm.candidate_name !~* '\m(america/|gmt|utc)\M'
    and array_length(regexp_split_to_array(flm.candidate_name, '\s+'), 1) between 2 and 6
),
invalid_leads as (
  select
    l.id as lead_id
  from public.atendimento_leads l
  where coalesce(btrim(l.full_name), '') = ''
     or l.full_name ~ '[0-9]'
     or l.full_name ~* '[@/:\\]'
     or l.full_name ~* '\m(america/|gmt|utc)\M'
     or array_length(regexp_split_to_array(trim(regexp_replace(coalesce(l.full_name, ''), '\s+', ' ', 'g')), '\s+'), 1) < 2
     or lower(trim(coalesce(l.full_name, ''))) = lower(trim(coalesce(l.city, '')))
     or lower(trim(coalesce(l.full_name, ''))) = lower(trim(coalesce(l.state, '')))
     or lower(trim(coalesce(l.full_name, ''))) = lower(trim(coalesce(l.country, '')))
     or lower(trim(coalesce(l.full_name, ''))) = lower(trim(coalesce(l.timezone, '')))
     or lower(trim(coalesce(l.full_name, ''))) = lower(trim(coalesce(l.best_contact_time, '')))
)
select
  il.lead_id,
  cn.candidate_name
from invalid_leads il
join candidate_names cn
  on cn.lead_id = il.lead_id;

update public.atendimento_leads l
set
  full_name = r.candidate_name,
  updated_at = now()
from temp_atendimento_name_repairs r
where l.id = r.lead_id
  and coalesce(btrim(r.candidate_name), '') <> '';

update public.atendimento_captured_fields cf
set
  field_value = r.candidate_name,
  updated_at = now()
from temp_atendimento_name_repairs r
where cf.lead_id = r.lead_id
  and cf.field_name = 'full_name';

insert into public.atendimento_captured_fields (
  lead_id,
  field_name,
  field_value,
  confidence,
  created_at,
  updated_at
)
select
  r.lead_id,
  'full_name',
  r.candidate_name,
  0.99,
  now(),
  now()
from temp_atendimento_name_repairs r
where not exists (
  select 1
  from public.atendimento_captured_fields cf
  where cf.lead_id = r.lead_id
    and cf.field_name = 'full_name'
);

do $$
declare
  repaired_count integer := 0;
begin
  select count(*) into repaired_count from temp_atendimento_name_repairs;
  raise notice 'atendimento contaminated full names repaired: %', repaired_count;
end
$$;

commit;
