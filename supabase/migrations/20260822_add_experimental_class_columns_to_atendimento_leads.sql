DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'experimental_class_booking_id') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN experimental_class_booking_id UUID REFERENCES public.atendimento_experimental_class_bookings(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'experimental_class_status') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN experimental_class_status TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'experimental_class_lead_date') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN experimental_class_lead_date TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'experimental_class_lead_time') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN experimental_class_lead_time TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'experimental_class_professor_date') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN experimental_class_professor_date TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'experimental_class_professor_time') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN experimental_class_professor_time TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'experimental_class_lead_start_at') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN experimental_class_lead_start_at TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'experimental_class_professor_start_at') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN experimental_class_professor_start_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'latest_experimental_class_cancelled_at') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN latest_experimental_class_cancelled_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'experimental_class_link') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN experimental_class_link TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'future_experimental_class_booking') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN future_experimental_class_booking JSONB DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_leads' AND column_name = 'latest_past_class_meta') THEN
    ALTER TABLE public.atendimento_leads ADD COLUMN latest_past_class_meta JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;

