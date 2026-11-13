DO $$
BEGIN
  ALTER TABLE public.atendimento_leads
    ADD COLUMN IF NOT EXISTS experimental_class_mode_preference TEXT,
    ADD COLUMN IF NOT EXISTS experimental_class_group_interest BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS experimental_class_group_interest_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS experimental_class_group_class_id UUID,
    ADD COLUMN IF NOT EXISTS experimental_class_group_status TEXT;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.atendimento_experimental_group_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professor_name TEXT NOT NULL,
  professor_phone TEXT NOT NULL,
  professor_timezone TEXT NOT NULL DEFAULT 'America/Cuiaba',
  professor_weekday TEXT NOT NULL,
  professor_date DATE NOT NULL,
  professor_time TEXT NOT NULL,
  professor_start_at TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'draft',
  confirmed_at TIMESTAMPTZ,
  lesson_link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atendimento_experimental_group_classes_capacity_check CHECK (capacity BETWEEN 1 AND 4),
  CONSTRAINT atendimento_experimental_group_classes_status_check CHECK (status IN ('draft', 'confirmed', 'cancelled', 'completed')),
  CONSTRAINT atendimento_experimental_group_classes_weekday_check CHECK (professor_weekday IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'))
);

ALTER TABLE public.atendimento_experimental_group_classes ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS atendimento_experimental_group_classes_professor_start_at_key
  ON public.atendimento_experimental_group_classes (professor_start_at);

CREATE INDEX IF NOT EXISTS atendimento_experimental_group_classes_status_idx
  ON public.atendimento_experimental_group_classes (status, professor_start_at);

CREATE TABLE IF NOT EXISTS public.atendimento_experimental_group_class_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_class_id UUID NOT NULL REFERENCES public.atendimento_experimental_group_classes(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.atendimento_leads(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.atendimento_conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'assigned',
  student_notification_sent_at TIMESTAMPTZ,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atendimento_experimental_group_class_members_status_check CHECK (status IN ('assigned', 'removed'))
);

ALTER TABLE public.atendimento_experimental_group_class_members ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS atendimento_experimental_group_class_members_group_lead_key
  ON public.atendimento_experimental_group_class_members (group_class_id, lead_id);

CREATE UNIQUE INDEX IF NOT EXISTS atendimento_experimental_group_class_members_active_lead_key
  ON public.atendimento_experimental_group_class_members (lead_id)
  WHERE status = 'assigned';

CREATE INDEX IF NOT EXISTS atendimento_experimental_group_class_members_group_status_idx
  ON public.atendimento_experimental_group_class_members (group_class_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'atendimento_leads'
      AND constraint_name = 'atendimento_leads_experimental_group_class_id_fkey'
  ) THEN
    ALTER TABLE public.atendimento_leads
      ADD CONSTRAINT atendimento_leads_experimental_group_class_id_fkey
      FOREIGN KEY (experimental_class_group_class_id)
      REFERENCES public.atendimento_experimental_group_classes(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

CREATE OR REPLACE FUNCTION public.assign_atendimento_experimental_group_member(
  p_lead_id UUID,
  p_conversation_id UUID,
  p_professor_name TEXT,
  p_professor_phone TEXT,
  p_professor_timezone TEXT,
  p_professor_weekday TEXT,
  p_professor_date DATE,
  p_professor_time TEXT,
  p_professor_start_at TIMESTAMPTZ,
  p_capacity INTEGER DEFAULT 4
)
RETURNS TABLE (
  group_class_id UUID,
  member_id UUID,
  occupied_seats INTEGER,
  available_seats INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_group_id UUID;
  v_group_status TEXT;
  v_group_capacity INTEGER;
  v_member_id UUID;
  v_occupied INTEGER;
  v_existing_other_group UUID;
  v_already_assigned BOOLEAN;
BEGIN
  INSERT INTO public.atendimento_experimental_group_classes (
    professor_name,
    professor_phone,
    professor_timezone,
    professor_weekday,
    professor_date,
    professor_time,
    professor_start_at,
    capacity,
    status,
    updated_at
  )
  VALUES (
    COALESCE(NULLIF(BTRIM(p_professor_name), ''), 'Professor'),
    COALESCE(NULLIF(BTRIM(p_professor_phone), ''), ''),
    COALESCE(NULLIF(BTRIM(p_professor_timezone), ''), 'America/Cuiaba'),
    LOWER(COALESCE(NULLIF(BTRIM(p_professor_weekday), ''), 'mon')),
    p_professor_date,
    COALESCE(NULLIF(BTRIM(p_professor_time), ''), '08:00'),
    p_professor_start_at,
    LEAST(GREATEST(COALESCE(p_capacity, 4), 1), 4),
    'draft',
    NOW()
  )
  ON CONFLICT (professor_start_at) DO UPDATE
    SET professor_name = EXCLUDED.professor_name,
        professor_phone = EXCLUDED.professor_phone,
        professor_timezone = EXCLUDED.professor_timezone,
        professor_weekday = EXCLUDED.professor_weekday,
        professor_date = EXCLUDED.professor_date,
        professor_time = EXCLUDED.professor_time,
        capacity = EXCLUDED.capacity,
        updated_at = NOW()
  RETURNING id INTO v_group_id;

  SELECT status, capacity
    INTO v_group_status, v_group_capacity
  FROM public.atendimento_experimental_group_classes
  WHERE id = v_group_id
  FOR UPDATE;

  IF v_group_status IN ('cancelled', 'completed') THEN
    UPDATE public.atendimento_experimental_group_classes
      SET status = 'draft',
          confirmed_at = NULL,
          updated_at = NOW()
    WHERE id = v_group_id;
    v_group_status := 'draft';
  END IF;

  SELECT group_class_id
    INTO v_existing_other_group
  FROM public.atendimento_experimental_group_class_members
  WHERE lead_id = p_lead_id
    AND status = 'assigned'
    AND group_class_id <> v_group_id
  LIMIT 1;

  IF v_existing_other_group IS NOT NULL THEN
    RAISE EXCEPTION 'lead_already_assigned_to_other_group'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.atendimento_experimental_group_class_members
    WHERE group_class_id = v_group_id
      AND lead_id = p_lead_id
      AND status = 'assigned'
  ) INTO v_already_assigned;

  SELECT COUNT(*)
    INTO v_occupied
  FROM public.atendimento_experimental_group_class_members
  WHERE group_class_id = v_group_id
    AND status = 'assigned';

  IF NOT v_already_assigned AND v_occupied >= v_group_capacity THEN
    RAISE EXCEPTION 'group_class_full'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.atendimento_experimental_group_class_members (
    group_class_id,
    lead_id,
    conversation_id,
    status,
    assigned_at,
    updated_at
  )
  VALUES (
    v_group_id,
    p_lead_id,
    p_conversation_id,
    'assigned',
    NOW(),
    NOW()
  )
  ON CONFLICT (group_class_id, lead_id) DO UPDATE
    SET conversation_id = EXCLUDED.conversation_id,
        status = 'assigned',
        assigned_at = NOW(),
        updated_at = NOW()
  RETURNING id INTO v_member_id;

  UPDATE public.atendimento_experimental_group_classes
    SET updated_at = NOW()
  WHERE id = v_group_id;

  SELECT COUNT(*)
    INTO v_occupied
  FROM public.atendimento_experimental_group_class_members
  WHERE group_class_id = v_group_id
    AND status = 'assigned';

  RETURN QUERY
  SELECT
    v_group_id,
    v_member_id,
    v_occupied,
    GREATEST(v_group_capacity - v_occupied, 0);
END;
$$;
