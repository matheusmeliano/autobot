DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'atendimento_leads' AND column_name = 'experimental_class_professor_name') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN experimental_class_professor_name TEXT DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'atendimento_leads' AND column_name = 'experimental_class_professor_phone') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN experimental_class_professor_phone TEXT DEFAULT NULL;
  END IF;
END $$;
