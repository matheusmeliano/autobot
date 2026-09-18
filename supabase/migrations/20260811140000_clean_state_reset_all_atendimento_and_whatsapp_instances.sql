-- MIGRACAO LIMPEZA TOTAL DO FLUXO DE ATENDIMENTO
-- Objetivo: deixar o sistema como se NENHUM numero tivesse sido conectado
-- e NENHUMA mensagem tivesse sido enviada anteriormente.

-- 1) Limpa atendimento e todas tabelas relacionadas (messagens, historico, agendamentos).
TRUNCATE TABLE
  atendimento_history_events,
  atendimento_leads
RESTART IDENTITY CASCADE;

-- 2) Limpa instancias WhatsApp (desconecta o numero atualmente conectado).
-- Também limpa qualquer log de status anterior.
TRUNCATE TABLE
  whatsapp_instances
RESTART IDENTITY CASCADE;

-- (Tabelas secundarias, existirem ou nao, sao limpas via CASCADE acima.
--  Exemplos: atendimento_conversation_messages, atendimento_bookings,
--  atendimento_presence_sessions, whatsapp_instance_status_logs.)
