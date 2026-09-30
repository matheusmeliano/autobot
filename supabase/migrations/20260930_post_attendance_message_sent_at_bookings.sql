-- =============================================================================
-- Adiciona coluna post_attendance_message_sent_at na tabela de bookings
-- experimental para persistir a marcacao de "mensagem de matricula pos-aula
-- ja enviada" (botao verde Check). Usado para o disabled do frontend nao
-- ficar sobrescrito apos cada refetch da lista de leads.
-- =============================================================================

alter table if exists public.atendimento_experimental_class_bookings
  add column if not exists post_attendance_message_sent_at timestamptz;

comment on column public.atendimento_experimental_class_bookings.post_attendance_message_sent_at is
  'Timestamp do envio (bem sucedido) da mensagem de matricula de pos-aula experimental para o aluno via botao verde Check. NULL significa que a mensagem ainda nao foi enviada. Usado para disabled do botao no frontend.';

create index if not exists atendimento_exp_bookings_post_att_sent_at_idx
  on public.atendimento_experimental_class_bookings (post_attendance_message_sent_at desc)
  where post_attendance_message_sent_at is not null;
