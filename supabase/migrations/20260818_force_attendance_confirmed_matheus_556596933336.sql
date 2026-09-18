-- Insere evento experimental_class_attendance_confirmed para MATHEUS (556596933336)
-- Garante status "Concluído" na hierarquia de exibição
INSERT INTO public.atendimento_history_events (
  id,
  lead_id,
  event_type,
  title,
  details,
  actor_type,
  actor_email,
  created_at
)
SELECT
  gen_random_uuid() AS id,
  l.id AS lead_id,
  'experimental_class_attendance_confirmed' AS event_type,
  'Comparecimento confirmado na aula experimental' AS title,
  jsonb_build_object('source', 'manual_fix', 'phone', l.phone, 'reason', 'override_mat_us_556596933336_concluido') AS details,
  'system' AS actor_type,
  'atendimento.usa.music@gmail.com' AS actor_email,
  NOW() AS created_at
FROM public.atendimento_leads l
WHERE l.phone = '556596933336'
  AND NOT EXISTS (
    SELECT 1 FROM public.atendimento_history_events ev
    WHERE ev.lead_id = l.id
      AND ev.event_type = 'experimental_class_attendance_confirmed'
  );
