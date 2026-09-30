-- =============================================================================
-- Migration: Adiciona TODAS as colunas faltantes em public.atendimento_leads
-- Objetivo: Eliminar completamente a necessidade da BLACKLIST no submit route.
--
-- Todas as colunas listadas aqui sao colunas que o codigo ja referenciava
-- ha tempos mas NUNCA foram criadas via migration no banco de producao,
-- causando erro 42703 "column does not exist" no UPDATE apos o cadastro de
-- matricula (POST /cadastro/recorrente/submit) e consequentemente o
-- mecanismo de stripPatch() da BLACKLIST removia colunas importantes antes
-- do retry. Principal coluna impactada: recurring_registration_step.
--
-- Data: 2026-09-30
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Progresso do cadastro recorrente (etapa 0 a 6)
--    Coluna critica: usada para renderizar avatar AZUL no atendimento
--    (helper getAvatarColorClassesForLead: step > 0 = azul)
-- -----------------------------------------------------------------------------
alter table if exists public.atendimento_leads
  add column if not exists recurring_registration_step smallint not null default 0;

comment on column public.atendimento_leads.recurring_registration_step is
  'Etapa atual do cadastro de matricula (recurring). Valores: 0 = nao iniciado / nenhuma senha criada, 1 = senha inicial criada (registro inicial concluido), 2 = cidade/estado/fuso horario confirmados, 3 = dia e horario da aula recorrente selecionados, 4 = dados cadastrais completos, 5 = contrato enviado / assinatura pendente, 6 = contrato assinado + pagamento confirmado (aluno matriculado). Helper avatar AZUL: step > 0.';

-- -----------------------------------------------------------------------------
-- 2) Senha da conta recorrente (plataforma do aluno)
-- -----------------------------------------------------------------------------
alter table if exists public.atendimento_leads
  add column if not exists recurring_registration_password text;

comment on column public.atendimento_leads.recurring_registration_password is
  'Senha criada pelo aluno no fluxo de /cadastro/recorrente para acessar a area do aluno. Armazenada em texto plano por enquanto (melhorar para hash Argon2 no futuro).';

-- -----------------------------------------------------------------------------
-- 3) Senha temporaria de signup (usada por links especiais de convite)
-- -----------------------------------------------------------------------------
alter table if exists public.atendimento_leads
  add column if not exists signup_password_raw_temp text;

comment on column public.atendimento_leads.signup_password_raw_temp is
  'Senha temporaria pre-preenchida em links de convite / signup especial. Limpa apos primeiro login ou criacao de senha definitiva.';

-- -----------------------------------------------------------------------------
-- 4) Dados do responsavel legal (menores de idade)
-- -----------------------------------------------------------------------------
alter table if exists public.atendimento_leads
  add column if not exists legal_responsible_name text;
alter table if exists public.atendimento_leads
  add column if not exists legal_responsible_cpf text;

-- -----------------------------------------------------------------------------
-- 5) Contrato de matricula (status, assinatura, PDF, snapshot HTML)
-- -----------------------------------------------------------------------------
alter table if exists public.atendimento_leads
  add column if not exists contract_status text;
alter table if exists public.atendimento_leads
  add column if not exists contract_signed_at timestamptz;
alter table if exists public.atendimento_leads
  add column if not exists contract_pdf_url text;
alter table if exists public.atendimento_leads
  add column if not exists contract_html_snapshot text;

comment on column public.atendimento_leads.contract_status is
  'nao_iniciado | coletando_dados | aguardando_aceite | assinado | rejeitado';

-- -----------------------------------------------------------------------------
-- 6) Pagamento da matricula (status e timestamps)
-- -----------------------------------------------------------------------------
alter table if exists public.atendimento_leads
  add column if not exists payment_status text;
alter table if exists public.atendimento_leads
  add column if not exists payment_confirmed_at timestamptz;
alter table if exists public.atendimento_leads
  add column if not exists payment_rejected_at timestamptz;

comment on column public.atendimento_leads.payment_status is
  'nao_iniciado | pendente_confirmacao | nao_realizado | confirmado | matriculado';

-- -----------------------------------------------------------------------------
-- 7) Numero de matricula / enrollment (gerado automaticamente pos-contrato)
-- -----------------------------------------------------------------------------
alter table if exists public.atendimento_leads
  add column if not exists enrollment_number text;

-- -----------------------------------------------------------------------------
-- 8) Dados da aula recorrente (dia, horario, primeira aula, criacao)
-- -----------------------------------------------------------------------------
alter table if exists public.atendimento_leads
  add column if not exists recurring_class_status text;
alter table if exists public.atendimento_leads
  add column if not exists recurring_class_weekday text;
alter table if exists public.atendimento_leads
  add column if not exists recurring_class_weekday_label text;
alter table if exists public.atendimento_leads
  add column if not exists recurring_class_professor_time text;
alter table if exists public.atendimento_leads
  add column if not exists recurring_class_lead_time text;
alter table if exists public.atendimento_leads
  add column if not exists recurring_class_professor_date text;
alter table if exists public.atendimento_leads
  add column if not exists recurring_class_first_class_at timestamptz;
alter table if exists public.atendimento_leads
  add column if not exists recurring_class_created_at timestamptz;

comment on column public.atendimento_leads.recurring_class_weekday is
  'mon | tue | wed | thu | fri | sat | sun';

-- -----------------------------------------------------------------------------
-- 9) Timestamp do envio da mensagem de pos-aula experimental (botao verde Check)
--    Obs: migration anterior 20260930_post_attendance_message_sent_at_bookings
--    criou APENAS na tabela de bookings; aqui garantimos a coluna FLAT no lead.
-- -----------------------------------------------------------------------------
alter table if exists public.atendimento_leads
  add column if not exists experimental_class_post_attendance_message_sent_at timestamptz;

comment on column public.atendimento_leads.experimental_class_post_attendance_message_sent_at is
  'Timestamp do envio (bem sucedido) da mensagem de matricula de pos-aula experimental enviada via botao verde Check. Salva na linha FLAT do lead como sincronizacao adicional; origem da verdade = atendimento_experimental_class_bookings.post_attendance_message_sent_at.';

-- =============================================================================
-- INDICES (performance para filtros e listagens)
-- =============================================================================

-- Progresso do cadastro (filtrar alunos "em processo de matricula")
create index if not exists atendimento_leads_recurring_step_idx
  on public.atendimento_leads (recurring_registration_step desc, updated_at desc)
  where recurring_registration_step > 0;

-- Status de contrato
create index if not exists atendimento_leads_contract_status_idx
  on public.atendimento_leads (contract_status, updated_at desc)
  where contract_status is not null;

-- Status de pagamento
create index if not exists atendimento_leads_payment_status_idx
  on public.atendimento_leads (payment_status, updated_at desc)
  where payment_status is not null;

-- Numero de matricula (unique)
create unique index if not exists atendimento_leads_enrollment_number_uniq
  on public.atendimento_leads (enrollment_number)
  where enrollment_number is not null;

-- Post attendance message sent
create index if not exists atendimento_leads_post_att_sent_at_idx
  on public.atendimento_leads (experimental_class_post_attendance_message_sent_at desc)
  where experimental_class_post_attendance_message_sent_at is not null;
