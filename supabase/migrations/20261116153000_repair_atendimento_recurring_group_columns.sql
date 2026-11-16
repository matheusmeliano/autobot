DO $$
BEGIN
  ALTER TABLE public.atendimento_leads
    ADD COLUMN IF NOT EXISTS recurring_class_group_pair_id TEXT,
    ADD COLUMN IF NOT EXISTS recurring_class_group_status TEXT,
    ADD COLUMN IF NOT EXISTS recurring_class_professor_name TEXT,
    ADD COLUMN IF NOT EXISTS recurring_class_professor_phone TEXT,
    ADD COLUMN IF NOT EXISTS recurring_class_weekday TEXT,
    ADD COLUMN IF NOT EXISTS recurring_class_weekday_label TEXT,
    ADD COLUMN IF NOT EXISTS recurring_class_professor_time TEXT,
    ADD COLUMN IF NOT EXISTS recurring_class_lead_time TEXT,
    ADD COLUMN IF NOT EXISTS recurring_class_professor_timezone TEXT,
    ADD COLUMN IF NOT EXISTS recurring_class_lead_timezone TEXT,
    ADD COLUMN IF NOT EXISTS recurring_class_first_class_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS recurring_class_student_start_notification_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS recurring_class_attendant_start_notification_sent_at TIMESTAMPTZ;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS atendimento_leads_recurring_class_group_pair_id_idx
  ON public.atendimento_leads (recurring_class_group_pair_id);

NOTIFY pgrst, 'reload schema';
