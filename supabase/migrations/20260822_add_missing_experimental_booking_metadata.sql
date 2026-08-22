DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_experimental_class_bookings' AND column_name = 'attendance_status') THEN
    ALTER TABLE public.atendimento_experimental_class_bookings ADD COLUMN attendance_status TEXT DEFAULT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_experimental_class_bookings' AND column_name = 'attendance_checked_at') THEN
    ALTER TABLE public.atendimento_experimental_class_bookings ADD COLUMN attendance_checked_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_experimental_class_bookings' AND column_name = 'student_start_notification_sent_at') THEN
    ALTER TABLE public.atendimento_experimental_class_bookings ADD COLUMN student_start_notification_sent_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_experimental_class_bookings' AND column_name = 'attendant_start_notification_sent_at') THEN
    ALTER TABLE public.atendimento_experimental_class_bookings ADD COLUMN attendant_start_notification_sent_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_experimental_class_bookings' AND column_name = 'source') THEN
    ALTER TABLE public.atendimento_experimental_class_bookings ADD COLUMN source TEXT DEFAULT 'manual';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'atendimento_experimental_class_bookings' AND column_name = 'lesson_link') THEN
    ALTER TABLE public.atendimento_experimental_class_bookings ADD COLUMN lesson_link TEXT;
  END IF;
END $$;
