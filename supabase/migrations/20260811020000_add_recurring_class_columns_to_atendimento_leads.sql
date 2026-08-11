-- Migration: adiciona colunas de aulas recorrentes (fixas) na tabela atendimento_leads
-- Usadas no fluxo de cadastro pela plataforma (/cadastro/recorrente) após resposta SIM no WhatsApp

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'recurring_class_status') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN recurring_class_status TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'recurring_class_weekday') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN recurring_class_weekday TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'recurring_class_weekday_label') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN recurring_class_weekday_label TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'recurring_class_professor_time') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN recurring_class_professor_time TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'recurring_class_lead_time') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN recurring_class_lead_time TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'recurring_class_created_at') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN recurring_class_created_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'signup_password_raw_temp') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN signup_password_raw_temp TEXT;
  END IF;
END $$;
