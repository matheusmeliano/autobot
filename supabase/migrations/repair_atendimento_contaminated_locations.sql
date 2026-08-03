begin;

create temp table temp_atendimento_location_repairs on commit drop as
with ddd_location as (
  select
    l.id as lead_id,
    l.phone as phone,
    (regexp_match(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), '^55(\d{2})\d{8,9}$'))[1] as ddd,
    l.city as current_city,
    l.state as current_state,
    l.timezone as current_timezone,
    l.country as current_country
  from public.atendimento_leads l
  where coalesce(btrim(l.phone), '') <> ''
),
ddd_state_timezone_map(ddd, state, timezone, country) as (
  values
    ('11', 'São Paulo', 'America/Sao_Paulo', 'BR'),
    ('12', 'São Paulo', 'America/Sao_Paulo', 'BR'),
    ('13', 'São Paulo', 'America/Sao_Paulo', 'BR'),
    ('14', 'São Paulo', 'America/Sao_Paulo', 'BR'),
    ('15', 'São Paulo', 'America/Sao_Paulo', 'BR'),
    ('16', 'São Paulo', 'America/Sao_Paulo', 'BR'),
    ('17', 'São Paulo', 'America/Sao_Paulo', 'BR'),
    ('18', 'São Paulo', 'America/Sao_Paulo', 'BR'),
    ('19', 'São Paulo', 'America/Sao_Paulo', 'BR'),
    ('21', 'Rio de Janeiro', 'America/Sao_Paulo', 'BR'),
    ('22', 'Rio de Janeiro', 'America/Sao_Paulo', 'BR'),
    ('24', 'Rio de Janeiro', 'America/Sao_Paulo', 'BR'),
    ('27', 'Espírito Santo', 'America/Sao_Paulo', 'BR'),
    ('28', 'Espírito Santo', 'America/Sao_Paulo', 'BR'),
    ('31', 'Minas Gerais', 'America/Sao_Paulo', 'BR'),
    ('32', 'Minas Gerais', 'America/Sao_Paulo', 'BR'),
    ('33', 'Minas Gerais', 'America/Sao_Paulo', 'BR'),
    ('34', 'Minas Gerais', 'America/Sao_Paulo', 'BR'),
    ('35', 'Minas Gerais', 'America/Sao_Paulo', 'BR'),
    ('37', 'Minas Gerais', 'America/Sao_Paulo', 'BR'),
    ('38', 'Minas Gerais', 'America/Sao_Paulo', 'BR'),
    ('41', 'Paraná', 'America/Sao_Paulo', 'BR'),
    ('42', 'Paraná', 'America/Sao_Paulo', 'BR'),
    ('43', 'Paraná', 'America/Sao_Paulo', 'BR'),
    ('44', 'Paraná', 'America/Sao_Paulo', 'BR'),
    ('45', 'Paraná', 'America/Sao_Paulo', 'BR'),
    ('46', 'Paraná', 'America/Sao_Paulo', 'BR'),
    ('47', 'Santa Catarina', 'America/Sao_Paulo', 'BR'),
    ('48', 'Santa Catarina', 'America/Sao_Paulo', 'BR'),
    ('49', 'Santa Catarina', 'America/Sao_Paulo', 'BR'),
    ('51', 'Rio Grande do Sul', 'America/Sao_Paulo', 'BR'),
    ('53', 'Rio Grande do Sul', 'America/Sao_Paulo', 'BR'),
    ('54', 'Rio Grande do Sul', 'America/Sao_Paulo', 'BR'),
    ('55', 'Rio Grande do Sul', 'America/Sao_Paulo', 'BR'),
    ('61', 'Distrito Federal', 'America/Sao_Paulo', 'BR'),
    ('62', 'Goiás', 'America/Sao_Paulo', 'BR'),
    ('64', 'Goiás', 'America/Sao_Paulo', 'BR'),
    ('63', 'Tocantins', 'America/Araguaia', 'BR'),
    ('65', 'Mato Grosso', 'America/Cuiaba', 'BR'),
    ('66', 'Mato Grosso', 'America/Cuiaba', 'BR'),
    ('67', 'Mato Grosso do Sul', 'America/Campo_Grande', 'BR'),
    ('68', 'Acre', 'America/Rio_Branco', 'BR'),
    ('69', 'Rondônia', 'America/Porto_Velho', 'BR'),
    ('71', 'Bahia', 'America/Bahia', 'BR'),
    ('73', 'Bahia', 'America/Bahia', 'BR'),
    ('74', 'Bahia', 'America/Bahia', 'BR'),
    ('75', 'Bahia', 'America/Bahia', 'BR'),
    ('77', 'Bahia', 'America/Bahia', 'BR'),
    ('79', 'Sergipe', 'America/Maceio', 'BR'),
    ('81', 'Pernambuco', 'America/Recife', 'BR'),
    ('82', 'Alagoas', 'America/Maceio', 'BR'),
    ('83', 'Paraíba', 'America/Fortaleza', 'BR'),
    ('84', 'Rio Grande do Norte', 'America/Fortaleza', 'BR'),
    ('85', 'Ceará', 'America/Fortaleza', 'BR'),
    ('86', 'Piauí', 'America/Fortaleza', 'BR'),
    ('87', 'Pernambuco', 'America/Recife', 'BR'),
    ('88', 'Ceará', 'America/Fortaleza', 'BR'),
    ('89', 'Piauí', 'America/Fortaleza', 'BR'),
    ('91', 'Pará', 'America/Belem', 'BR'),
    ('92', 'Amazonas', 'America/Manaus', 'BR'),
    ('93', 'Pará', 'America/Belem', 'BR'),
    ('94', 'Pará', 'America/Belem', 'BR'),
    ('95', 'Roraima', 'America/Boa_Vista', 'BR'),
    ('96', 'Amapá', 'America/Belem', 'BR'),
    ('97', 'Amazonas', 'America/Manaus', 'BR'),
    ('98', 'Maranhão', 'America/Fortaleza', 'BR'),
    ('99', 'Maranhão', 'America/Fortaleza', 'BR')
),
suspects as (
  select
    l.id as lead_id,
    case
      when coalesce(btrim(l.city), '') <> ''
        and (
          array_length(regexp_split_to_array(btrim(regexp_replace(coalesce(l.city, ''), '\s+', ' ', 'g')), '\s'), 1) > 8
          or l.city ~* '(dias dispon|hor(?:a|á)rio dispon|responda apenas|informe o estado|informe novamente|nao foi possivel|não foi possível|precisamos de algumas|para agendarmos|agora e so escolher|agora é só escolher|melhor dia e horário|vamos começar|me diga seu nome|informe o número do seu whatsapp)'
          or btrim(l.city) in (
            'Perfeito. Para começarmos, me diga seu nome completo.',
            'Perfeito. Agora, informe o estado onde você mora.',
            'E a cidade?',
            'Agora é só escolher o melhor dia e horário para sua aula experimental.',
            'Para começarmos, qual dia você prefere?',
            'WhatsApp registrado com sucesso.'
          )
        )
      then true else false
    end as city_suspect,
    case
      when coalesce(btrim(l.state), '') <> ''
        and (
          array_length(regexp_split_to_array(btrim(regexp_replace(coalesce(l.state, ''), '\s+', ' ', 'g')), '\s'), 1) > 6
          or l.state ~* '(para agendarmos|precisamos de algumas|dias dispon|hor(?:a|á)rio dispon|responda apenas|nao foi possivel|não foi possível)'
          or btrim(l.state) in (
            'Perfeito. Para começarmos, me diga seu nome completo.',
            'Perfeito. Agora, informe o estado onde você mora.',
            'E a cidade?',
            'Agora é só escolher o melhor dia e horário para sua aula experimental.',
            'Para começarmos, qual dia você prefere?',
            'WhatsApp registrado com sucesso.'
          )
        )
      then true else false
    end as state_suspect
  from public.atendimento_leads l
)
select
  dl.lead_id,
  dl.current_city as old_city,
  dl.current_state as old_state,
  dl.current_timezone as old_timezone,
  dl.current_country as old_country,
  map.state as clean_state,
  null::text as clean_city,
  map.timezone as clean_timezone,
  case when map.country = 'BR' then 'Brasil' when map.country = 'US' then 'Estados Unidos' else null end as clean_country,
  s.city_suspect,
  s.state_suspect
from ddd_location dl
left join ddd_state_timezone_map map
  on map.ddd = dl.ddd
left join suspects s on s.lead_id = dl.lead_id
where coalesce(map.ddd, '') <> ''
  and (s.city_suspect or s.state_suspect);

update public.atendimento_leads l
set
  city = case when r.city_suspect then r.clean_city else l.city end,
  state = case when r.state_suspect then coalesce(r.clean_state, l.state) else l.state end,
  timezone = coalesce(r.clean_timezone, l.timezone),
  country = coalesce(r.clean_country, l.country),
  updated_at = now()
from temp_atendimento_location_repairs r
where l.id = r.lead_id
  and (r.city_suspect or r.state_suspect);

update public.atendimento_captured_fields cf
set
  field_value = case
    when cf.field_name = 'city' and r.city_suspect then ''
    when cf.field_name = 'state' and r.state_suspect then coalesce(r.clean_state, cf.field_value)
    else cf.field_value
  end,
  updated_at = now()
from temp_atendimento_location_repairs r
where cf.lead_id = r.lead_id
  and cf.field_name in ('city', 'state')
  and (r.city_suspect or r.state_suspect);

do $$
declare
  repaired_count integer := 0;
begin
  select count(*) into repaired_count from temp_atendimento_location_repairs r
    where r.city_suspect or r.state_suspect;
  raise notice 'atendimento contaminated location fields repaired: %', repaired_count;
end
$$;

commit;
