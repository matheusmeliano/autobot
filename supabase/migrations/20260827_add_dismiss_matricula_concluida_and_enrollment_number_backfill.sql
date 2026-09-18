alter table if exists public.atendimento_leads
add column if not exists recurring_matricula_concluida_dismissed_at timestamptz null;
