DO $$
BEGIN
  ALTER TABLE public.atendimento_experimental_group_classes
    ADD COLUMN IF NOT EXISTS attendance_status TEXT,
    ADD COLUMN IF NOT EXISTS attendance_checked_at TIMESTAMPTZ;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

NOTIFY pgrst, 'reload schema';
