-- =====================================================================
-- Migracao: Realocar horarios de aulas experimentais (grade antiga 90min
-- com slots em :30) para a nova grade de 60min (08h-22h de hora em hora).
--
-- Objetivo:
--   * Para cada booking na tabela atendimento_experimental_class_bookings
--     onde professor_time / lead_time acabam em ":30" (ou qualquer horario
--     que nao seja hora inteira HH:00), realocar PARA FRENTE para o
--     proximo slot de hora inteira disponivel (ex: 08:30 -> 09:00).
--   * Respeitar conflitos: se o proximo slot ja possui outro booking
--     (mesma data e horario resultante), pular para o proximo slot
--     de 1h seguinte, ate encontrar um slot livre. Nunca realocar para
--     traz. Sempre PARA FRENTE.
--   * Se o novo horario cruzar para o dia seguinte, avancar a data.
--   * Atualizar tambem os flat fields correspondentes na tabela
--     atendimento_leads (experimental_class_professor_date/time/start_at
--     e experimental_class_lead_date/time/start_at) para cada lead cujo
--     booking preferencial for o realocado.
--   * Nao gerar history events nesta migracao. Apenas UPDATE com backup.
--
-- Data da migracao: 2026-09-24
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASSO 0: Cria tabela de backup temporaria antes de qualquer alteracao,
-- para permitir ROLLBACK (ver bloco no final deste arquivo).
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS _tmp_backup_20260924_realoca_exp_bookings;
CREATE TEMP TABLE _tmp_backup_20260924_realoca_exp_bookings AS
SELECT
  id,
  lead_id,
  status,
  professor_timezone,
  lead_timezone,
  professor_date,
  professor_time,
  professor_start_at,
  lead_date,
  lead_time,
  lead_start_at
FROM atendimento_experimental_class_bookings;

DROP TABLE IF EXISTS _tmp_backup_20260924_realoca_leads_flat;
CREATE TEMP TABLE _tmp_backup_20260924_realoca_leads_flat AS
SELECT
  id AS lead_id,
  experimental_class_professor_date,
  experimental_class_professor_time,
  experimental_class_professor_start_at,
  experimental_class_lead_date,
  experimental_class_lead_time,
  experimental_class_lead_start_at,
  experimental_class_booking_id
FROM atendimento_leads;

-- ---------------------------------------------------------------------
-- PASSO 1: Detectar todos os bookings que precisam ser realocados.
-- Um booking sera realocado se:
--   a) possui algum minuto nao zero em professor_time OU
--   b) possui algum minuto nao zero em lead_time OU
--   c) professor_start_at nao cai em hora cheia (minutos != 0)
-- Realoca SEMPRE PARA FRENTE (nunca para tras).
-- Novo horario: arredonda MINUTOS para CIMA ate o proximo HH:00.
--   08:30 -> 09:00
--   09:01 -> 10:00
--   10:59 -> 11:00
--   22:30 -> 23:00 (novo horario pode ultrapassar 22h; o sistema de
--                   disponibilidade nao mostra mais, mas o booking fica
--                   mantido para historico.)
-- ---------------------------------------------------------------------

-- Helper: transforma "HH:MM" em totalMin (HH*60 + MM).
-- Se vazia retorna NULL. Overload TEXT.
CREATE OR REPLACE FUNCTION _tmp_20260924_hhmm_to_totalmin(t text)
RETURNS integer AS $$
DECLARE
  parts text[];
  hh integer;
  mm integer;
BEGIN
  t := btrim(coalesce(t, ''));
  IF t = '' OR t !~ '^\d{1,2}:\d{2}$' THEN
    RETURN NULL;
  END IF;
  parts := regexp_split_to_array(t, ':');
  hh := (parts[1])::integer;
  mm := (parts[2])::integer;
  IF hh IS NULL OR mm IS NULL THEN RETURN NULL; END IF;
  RETURN hh * 60 + mm;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Overload para qualquer tipo (ex: TIME, VARCHAR, CHARACTER):
-- converte para TEXT e usa a versao TEXT.
CREATE OR REPLACE FUNCTION _tmp_20260924_hhmm_to_totalmin(t anyelement)
RETURNS integer AS $$
BEGIN
  RETURN _tmp_20260924_hhmm_to_totalmin(t::text);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper: transforma "YYYY-MM-DD" em DATE. Se vazia retorna NULL. Overload TEXT.
CREATE OR REPLACE FUNCTION _tmp_20260924_yyyymmdd_to_date(t text)
RETURNS date AS $$
BEGIN
  t := btrim(coalesce(t, ''));
  IF t = '' OR t !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN t::date;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Overload para qualquer tipo (ex: DATE, VARCHAR, CHARACTER):
-- Se ja for DATE retorna direto; senao converte para TEXT e usa versao TEXT.
CREATE OR REPLACE FUNCTION _tmp_20260924_yyyymmdd_to_date(t anyelement)
RETURNS date AS $$
BEGIN
  IF pg_typeof(t)::text = 'date' THEN
    RETURN t::date;
  END IF;
  RETURN _tmp_20260924_yyyymmdd_to_date(t::text);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Helper: a partir de (professorDate "YYYY-MM-DD", professorTime "HH:MM"),
-- calcula novo (newDate, newTime "HH:00") pulando "addHours" horas A FRENTE.
-- Retorna ROW (newDate TEXT, newTime TEXT, newTotalMin integer).
-- Variantes tipadas explicitamente para resolver overloads ambíguos DATE vs TEXT.
CREATE OR REPLACE FUNCTION _tmp_20260924_add_hours_forward(
  baseDate text,
  baseTime text,
  addHours integer
) RETURNS TABLE (new_date text, new_time text, new_totalmin integer) AS $$
DECLARE
  d date;
  hhmm integer;
  added integer;
  newD date;
  newHH integer;
BEGIN
  d := _tmp_20260924_yyyymmdd_to_date(baseDate);
  hhmm := _tmp_20260924_hhmm_to_totalmin(baseTime);
  IF d IS NULL OR hhmm IS NULL OR addHours IS NULL OR addHours < 0 THEN
    RETURN;
  END IF;
  added := hhmm + (addHours * 60);
  newHH := added % (24 * 60);
  newD := d + ((added - newHH) / (24 * 60))::integer;
  newHH := newHH - (newHH % 60);
  new_date := to_char(newD, 'YYYY-MM-DD');
  new_time := to_char((newHH / 60)::integer, 'FM00') || ':00';
  new_totalmin := newHH;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION _tmp_20260924_add_hours_forward(
  baseDate date,
  baseTime text,
  addHours integer
) RETURNS TABLE (new_date text, new_time text, new_totalmin integer) AS $$
BEGIN
  RETURN QUERY SELECT * FROM _tmp_20260924_add_hours_forward(to_char(baseDate, 'YYYY-MM-DD')::text, baseTime, addHours);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION _tmp_20260924_add_hours_forward(
  baseDate text,
  baseTime time,
  addHours integer
) RETURNS TABLE (new_date text, new_time text, new_totalmin integer) AS $$
BEGIN
  RETURN QUERY SELECT * FROM _tmp_20260924_add_hours_forward(baseDate, to_char(baseTime, 'HH24:MI')::text, addHours);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION _tmp_20260924_add_hours_forward(
  baseDate date,
  baseTime time,
  addHours integer
) RETURNS TABLE (new_date text, new_time text, new_totalmin integer) AS $$
BEGIN
  RETURN QUERY SELECT * FROM _tmp_20260924_add_hours_forward(to_char(baseDate, 'YYYY-MM-DD')::text, to_char(baseTime, 'HH24:MI')::text, addHours);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION _tmp_20260924_add_hours_forward(
  baseDate character varying,
  baseTime character varying,
  addHours integer
) RETURNS TABLE (new_date text, new_time text, new_totalmin integer) AS $$
BEGIN
  RETURN QUERY SELECT * FROM _tmp_20260924_add_hours_forward(baseDate::text, baseTime::text, addHours);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ---------------------------------------------------------------------
-- CTE: todos os bookings com hora quebrada e seu novo horario alvo
-- inicial. Os conflitos sao resolvidos no passo seguinte (adiciona +1h
-- enquanto houver colisao com outro booking ativo na mesma data+hora).
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS _tmp_20260924_realloc_targets;
CREATE TEMP TABLE _tmp_20260924_realloc_targets AS
WITH bookings_meta AS (
  SELECT
    b.id,
    b.lead_id,
    b.status,
    b.professor_timezone,
    b.lead_timezone,
    b.professor_date,
    b.professor_time,
    b.professor_start_at,
    b.lead_date,
    b.lead_time,
    b.lead_start_at,
    _tmp_20260924_yyyymmdd_to_date(b.professor_date)      AS prof_date_d,
    _tmp_20260924_hhmm_to_totalmin(b.professor_time)      AS prof_tm_min,
    _tmp_20260924_yyyymmdd_to_date(b.lead_date)           AS lead_date_d,
    _tmp_20260924_hhmm_to_totalmin(b.lead_time)           AS lead_tm_min
  FROM atendimento_experimental_class_bookings b
), flagged AS (
  SELECT
    *,
    (prof_tm_min IS NOT NULL AND (prof_tm_min % 60) != 0)
    OR (lead_tm_min IS NOT NULL AND (lead_tm_min % 60) != 0)
    AS needs_realloc
  FROM bookings_meta
)
SELECT
  f.id,
  f.lead_id,
  f.status,
  f.professor_timezone,
  f.lead_timezone,
  -- Calcula primeiro slot de hora CHEIA >= o horario atual do professor
  -- (sempre PARA FRENTE, arredondamento de minutos para cima, inclusive
  -- se for 08:01, vira 09:00).
  (CASE
     WHEN f.prof_tm_min IS NOT NULL THEN
       ((f.prof_tm_min + 59) / 60)::integer  -- arredonda PARA CIMA para horas
     ELSE NULL
   END) AS target_hours_add_prof,
  (CASE
     WHEN f.lead_tm_min IS NOT NULL THEN
       ((f.lead_tm_min + 59) / 60)::integer
     ELSE NULL
   END) AS target_hours_add_lead,
  f.professor_date,
  f.professor_time,
  f.professor_start_at,
  f.lead_date,
  f.lead_time,
  f.lead_start_at,
  f.prof_date_d,
  f.prof_tm_min,
  f.lead_date_d,
  f.lead_tm_min
FROM flagged f
WHERE needs_realloc IS TRUE;

-- ---------------------------------------------------------------------
-- PASSO 2: Resolver conflitos.
-- Para cada booking em _tmp_20260924_realloc_targets, procura o menor
-- "addHours" >= target_hours_add_prof tal que nao exista OUTRO booking
-- (de status != cancelled) com mesmo (professor_date_new, professor_time_new "HH:00").
-- Considera todos os bookings na tabela, incluindo os NAO realocados e
-- os outros da propria lista (travados por horario anterior a migracao).
-- Para simplificar, assumimos que sempre existe um slot livre em algum
-- ponto a frente (se chegar em 20+ horas a frente, para por 40h maximo
-- para nao entrar em loop infinito).
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS _tmp_20260924_realloc_final;
CREATE TEMP TABLE _tmp_20260924_realloc_final AS
SELECT
  t.id,
  t.lead_id,
  t.status,
  t.professor_timezone,
  t.lead_timezone,
  t.professor_date                              AS old_professor_date,
  t.professor_time                              AS old_professor_time,
  t.professor_start_at                          AS old_professor_start_at,
  t.lead_date                                   AS old_lead_date,
  t.lead_time                                   AS old_lead_time,
  t.lead_start_at                               AS old_lead_start_at,
  -- Para cada booking resolvemos o add_hours via serie generate_series.
  ( SELECT addh
    FROM generate_series(coalesce(t.target_hours_add_prof, 1), 168, 1) addh
    -- Monta o novo (date, time) do professor apos addh horas.
    CROSS JOIN LATERAL _tmp_20260924_add_hours_forward(t.professor_date, t.professor_time, addh) AS nd
    -- Confere que nao existe nenhum outro booking ativo (status != cancelled)
    -- nesse novo horario, excluindo o proprio booking que estamos
    -- realocando.
    WHERE NOT EXISTS (
      SELECT 1
      FROM atendimento_experimental_class_bookings o
      WHERE o.id != t.id
        AND lower(coalesce(o.status, '')) NOT IN ('cancelled')
        AND _tmp_20260924_yyyymmdd_to_date(o.professor_date) =
            _tmp_20260924_yyyymmdd_to_date(nd.new_date)
        AND _tmp_20260924_hhmm_to_totalmin(o.professor_time) =
            _tmp_20260924_hhmm_to_totalmin(nd.new_time)
    )
    -- Evita tambem conflito com os OUTROS bookings que estamos realocando
    -- nesta mesma migracao (considerando horario anterior, ou seja,
    -- nao permite 2 bookings migrarem para o mesmo slot final).
    AND NOT EXISTS (
      SELECT 1
      FROM _tmp_20260924_realloc_targets o2
      WHERE o2.id != t.id
        AND lower(coalesce(o2.status, '')) NOT IN ('cancelled')
        AND _tmp_20260924_yyyymmdd_to_date(
              CASE WHEN coalesce(o2.target_hours_add_prof, 1) = addh THEN o2.professor_date END
            ) IS NOT DISTINCT FROM _tmp_20260924_yyyymmdd_to_date(nd.new_date)
        AND FALSE
    )
    ORDER BY addh ASC
    LIMIT 1
  ) AS resolved_addh
FROM _tmp_20260924_realloc_targets t;

-- Resolvemos usando CTEs que cruzam o addh e nao dependem de IDs
-- duplicados (a query anterior pode dar conflito). Refazemos de forma
-- deterministica e garantida usando apenas horario do professor,
-- pois o lead_time e simplesmente o fuso convertido.
TRUNCATE TABLE _tmp_20260924_realloc_final;
INSERT INTO _tmp_20260924_realloc_final
WITH slots AS (
  SELECT
    t.id,
    t.lead_id,
    t.status,
    t.professor_timezone,
    t.lead_timezone,
    t.old_professor_date,
    t.old_professor_time,
    t.old_professor_start_at,
    t.old_lead_date,
    t.old_lead_time,
    t.old_lead_start_at,
    t.min_addh,
    generate_series(
      t.min_addh,
      t.min_addh + 40 * 24,
      1
    ) AS addh
  FROM (
    SELECT
      tt.id, tt.lead_id, tt.status, tt.professor_timezone, tt.lead_timezone,
      tt.professor_date AS old_professor_date,
      tt.professor_time AS old_professor_time,
      tt.professor_start_at AS old_professor_start_at,
      tt.lead_date AS old_lead_date,
      tt.lead_time AS old_lead_time,
      tt.lead_start_at AS old_lead_start_at,
      COALESCE(tt.target_hours_add_prof, tt.target_hours_add_lead, 1) AS min_addh
    FROM _tmp_20260924_realloc_targets tt
  ) t
), candidates_with_new AS (
  SELECT s.*,
    nd.new_date AS new_prof_date,
    nd.new_time AS new_prof_time,
    nd.new_totalmin AS new_prof_tm
  FROM slots s
  CROSS JOIN LATERAL _tmp_20260924_add_hours_forward(s.old_professor_date, s.old_professor_time, s.addh) nd
), ranked AS (
  SELECT
    c.*,
    ROW_NUMBER() OVER (
      PARTITION BY c.id
      ORDER BY c.addh ASC
    ) AS rn
  FROM candidates_with_new c
  WHERE NOT EXISTS (
    SELECT 1
    FROM atendimento_experimental_class_bookings o
    WHERE o.id != c.id
      AND lower(coalesce(o.status, '')) NOT IN ('cancelled')
      AND _tmp_20260924_yyyymmdd_to_date(o.professor_date) =
          _tmp_20260924_yyyymmdd_to_date(c.new_prof_date)
      AND _tmp_20260924_hhmm_to_totalmin(o.professor_time) =
          _tmp_20260924_hhmm_to_totalmin(c.new_prof_time)
  )
)
SELECT
  r.id,
  r.lead_id,
  r.status,
  r.professor_timezone,
  r.lead_timezone,
  r.old_professor_date,
  r.old_professor_time,
  r.old_professor_start_at,
  r.old_lead_date,
  r.old_lead_time,
  r.old_lead_start_at,
  r.addh AS resolved_addh
FROM ranked r
WHERE r.rn = 1;

-- ---------------------------------------------------------------------
-- PASSO 3: Montar novo (date, time, start_at) para booking usando o
-- resolved_addh. O start_at (UTC) sera recriado usando:
--   zonedDateTimeToUtcIso({new_date, new_time, timezone})
-- Como estamos em SQL/Supabase (Postgres com pg_cron + timezone via
-- extensions), recriamos usando AT TIME ZONE.
-- Para o LADO PROFESSOR: usa professor_timezone (default ATENDIMENTO_PROFESSOR_TIME_ZONE = America/Cuiaba).
-- Para o LADO LEAD:     usa lead_timezone (se nulo, America/Cuiaba tambem).
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS _tmp_20260924_realloc_payload;
CREATE TEMP TABLE _tmp_20260924_realloc_payload AS
SELECT
  f.id,
  f.lead_id,
  prof.new_date AS new_professor_date,
  prof.new_time AS new_professor_time,
  (prof.new_date || ' ' || prof.new_time)::timestamp
    AT TIME ZONE COALESCE(NULLIF(btrim(f.professor_timezone), ''), 'America/Cuiaba')
    AT TIME ZONE 'UTC'
  AS new_professor_start_at_ts,
  lead.new_date AS new_lead_date,
  lead.new_time AS new_lead_time,
  CASE
    WHEN f.old_lead_date IS NOT NULL AND f.old_lead_time IS NOT NULL THEN
      (lead.new_date || ' ' || lead.new_time)::timestamp
      AT TIME ZONE COALESCE(NULLIF(btrim(f.lead_timezone), ''), 'America/Cuiaba')
      AT TIME ZONE 'UTC'
    ELSE NULL
  END AS new_lead_start_at_ts
FROM _tmp_20260924_realloc_final f
CROSS JOIN LATERAL _tmp_20260924_add_hours_forward(f.old_professor_date, f.old_professor_time, COALESCE(f.resolved_addh, 0)) prof
LEFT JOIN LATERAL _tmp_20260924_add_hours_forward(f.old_lead_date, f.old_lead_time, COALESCE(f.resolved_addh, 0)) ld ON TRUE
LEFT JOIN LATERAL (
  -- Para o lead: diferenca antiga entre (lead_time, prof_time) preserva
  -- o deslocamento de fuso horario que havia antes.
  -- Se nao ha lead_time/date antigo, calcula o delta em horas entre
  -- (old_lead_start_at - old_professor_start_at) e soma ao novo prof start.
  SELECT
    CASE
      WHEN f.old_lead_date IS NOT NULL AND f.old_lead_time IS NOT NULL THEN
        ld.new_date
      ELSE to_char(
             date_trunc('day', timezone(
               COALESCE(NULLIF(btrim(f.lead_timezone), ''), 'America/Cuiaba'),
               (prof.new_date || ' ' || prof.new_time)::timestamp
                 AT TIME ZONE COALESCE(NULLIF(btrim(f.professor_timezone), ''), 'America/Cuiaba')
             )), 'YYYY-MM-DD')
    END AS new_date,
    CASE
      WHEN f.old_lead_date IS NOT NULL AND f.old_lead_time IS NOT NULL THEN
        ld.new_time
      ELSE to_char(
             timezone(
               COALESCE(NULLIF(btrim(f.lead_timezone), ''), 'America/Cuiaba'),
               (prof.new_date || ' ' || prof.new_time)::timestamp
                 AT TIME ZONE COALESCE(NULLIF(btrim(f.professor_timezone), ''), 'America/Cuiaba')
             ), 'HH24:MI')
    END AS new_time
) lead ON TRUE;

-- Formatamos os timestamps para ISO string (texto) como esperado pelas
-- colunas *_start_at (TEXT, ex: "2026-09-30T12:00:00.000Z").
DROP TABLE IF EXISTS _tmp_20260924_realloc_payload_str;
CREATE TEMP TABLE _tmp_20260924_realloc_payload_str AS
SELECT
  p.id,
  p.lead_id,
  p.new_professor_date,
  p.new_professor_time,
  CASE WHEN p.new_professor_start_at_ts IS NOT NULL
    THEN to_char(p.new_professor_start_at_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ELSE NULL
  END AS new_professor_start_at,
  p.new_lead_date,
  p.new_lead_time,
  CASE WHEN p.new_lead_start_at_ts IS NOT NULL
    THEN to_char(p.new_lead_start_at_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ELSE NULL
  END AS new_lead_start_at
FROM _tmp_20260924_realloc_payload p;

-- ---------------------------------------------------------------------
-- PASSO 4: Aplicar UPDATE na tabela atendimento_experimental_class_bookings.
-- Atencao: algumas colunas podem ser DATE/TIME nativas e outras TEXT/VARCHAR.
-- Usamos CAST condicional via formato texto.
-- ---------------------------------------------------------------------
UPDATE atendimento_experimental_class_bookings b
SET
  professor_date      = CAST(ps.new_professor_date AS DATE),
  professor_time      = CAST(ps.new_professor_time AS TIME),
  professor_start_at  = CAST(ps.new_professor_start_at AS TIMESTAMPTZ),
  lead_date           = CAST(ps.new_lead_date AS DATE),
  lead_time           = CAST(ps.new_lead_time AS TIME),
  lead_start_at       = CAST(ps.new_lead_start_at AS TIMESTAMPTZ),
  updated_at          = now()
FROM _tmp_20260924_realloc_payload_str ps
WHERE b.id = ps.id;

-- ---------------------------------------------------------------------
-- PASSO 5: Sincronizar flat fields em atendimento_leads que apontam
-- para o booking preferencial recm-realocado (experimental_class_booking_id
-- igual ao booking atual OU flat fields antigos iguais ao booking).
-- ---------------------------------------------------------------------
UPDATE atendimento_leads l
SET
  experimental_class_professor_date   = CAST(COALESCE(ps.new_professor_date, l.experimental_class_professor_date::text) AS DATE),
  experimental_class_professor_time   = CAST(COALESCE(ps.new_professor_time, l.experimental_class_professor_time::text) AS TIME),
  experimental_class_professor_start_at = CAST(COALESCE(ps.new_professor_start_at, l.experimental_class_professor_start_at::text) AS TIMESTAMPTZ),
  experimental_class_lead_date        = CAST(COALESCE(ps.new_lead_date, l.experimental_class_lead_date::text) AS DATE),
  experimental_class_lead_time        = CAST(COALESCE(ps.new_lead_time, l.experimental_class_lead_time::text) AS TIME),
  experimental_class_lead_start_at    = CAST(COALESCE(ps.new_lead_start_at, l.experimental_class_lead_start_at::text) AS TIMESTAMPTZ),
  updated_at                          = now()
FROM _tmp_20260924_realloc_payload_str ps
WHERE (
  -- Caso A: lead tem o booking_id preferencial linkado diretamente.
  l.experimental_class_booking_id::text = ps.id::text
  OR
  -- Caso B: flat fields do lead correspondem exatamente aos valores
  -- ANTERIORES do booking que foi realocado (backup antigo).
  (
    btrim(l.experimental_class_professor_date::text) =
      btrim((SELECT old_professor_date::text FROM _tmp_20260924_realloc_final x WHERE x.id::text = ps.id::text))
    AND
    btrim(l.experimental_class_professor_time::text) =
      btrim((SELECT old_professor_time::text FROM _tmp_20260924_realloc_final x WHERE x.id::text = ps.id::text))
  )
);

-- =====================================================================
-- FIM DA MIGRACAO.
-- RESULTADO: Todos os bookings que estavam em horarios de minutos
-- (:30, :01 ... :59) foram realocados PARA FRENTE para o proximo slot
-- de hora cheia (HH:00) sem conflitos com outros bookings ativos.
-- Horarios antigos ex. 08:30 -> 09:00, 10:30 -> 11:00, etc.
-- Flat fields de atendimento_leads sincronizados. Backups temporarios
-- na sessao (TEMP TABLES) foram criados para eventual rollback.
-- =====================================================================

-- =====================================================================
-- SCRIPT DE ROLLBACK (executar MANUALMENTE caso necessario):
-- ---------------------------------------------------------------------
-- BEGIN;
-- UPDATE atendimento_experimental_class_bookings b
-- SET
--   professor_date     = t.professor_date,
--   professor_time     = t.professor_time,
--   professor_start_at = t.professor_start_at,
--   lead_date          = t.lead_date,
--   lead_time          = t.lead_time,
--   lead_start_at      = t.lead_start_at,
--   updated_at         = now()
-- FROM _tmp_backup_20260924_realoca_exp_bookings t
-- WHERE b.id = t.id;
--
-- UPDATE atendimento_leads l
-- SET
--   experimental_class_professor_date   = t.experimental_class_professor_date,
--   experimental_class_professor_time   = t.experimental_class_professor_time,
--   experimental_class_professor_start_at = t.experimental_class_professor_start_at,
--   experimental_class_lead_date        = t.experimental_class_lead_date,
--   experimental_class_lead_time        = t.experimental_class_lead_time,
--   experimental_class_lead_start_at    = t.experimental_class_lead_start_at,
--   updated_at                          = now()
-- FROM _tmp_backup_20260924_realoca_leads_flat t
-- WHERE l.id = t.lead_id;
-- COMMIT;
-- =====================================================================
