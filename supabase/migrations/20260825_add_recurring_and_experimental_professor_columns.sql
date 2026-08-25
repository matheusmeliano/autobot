ALTER TABLE atendimento_leads
  ADD COLUMN IF NOT EXISTS recurring_class_professor_name TEXT,
  ADD COLUMN IF NOT EXISTS recurring_class_professor_phone TEXT;

ALTER TABLE atendimento_experimental_class_bookings
  ADD COLUMN IF NOT EXISTS assigned_professor_name TEXT,
  ADD COLUMN IF NOT EXISTS assigned_professor_phone TEXT;
