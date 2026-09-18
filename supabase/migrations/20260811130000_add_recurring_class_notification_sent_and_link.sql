-- Migration: adiciona colunas FALTANTES de aulas recorrentes na tabela atendimento_leads
-- (1) recurring_class_link = link da aula recorrente (ex: Google Meet)
-- (2) recurring_class_student_start_notification_sent_at = ultima vez que enviamos a notificacao ao aluno
-- (3) recurring_class_attendant_start_notification_sent_at = ultima vez que enviamos a notificacao ao atendente/professor
-- (4) recurring_class_professor_timezone = fuso horario customizado do professor para a ocorrencia
-- (5) recurring_class_lead_timezone = fuso horario customizado do aluno para a ocorrencia

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'recurring_class_link') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN recurring_class_link TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'recurring_class_student_start_notification_sent_at') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN recurring_class_student_start_notification_sent_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'recurring_class_attendant_start_notification_sent_at') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN recurring_class_attendant_start_notification_sent_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'recurring_class_professor_timezone') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN recurring_class_professor_timezone TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'recurring_class_lead_timezone') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN recurring_class_lead_timezone TEXT;
  END IF;
END $$;
