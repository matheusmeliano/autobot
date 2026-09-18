-- Ajuste de dados: Livia Silva / Telefone 15616098367
-- Objetivo: Forcar consistencia do registro na secao ALUNOS e AGENDAMENTOS.
-- ID do lead: 1a2fb29f-205b-4395-af57-0f8dcfeaada6
-- Dados atuais ja sao corretos, mas reafirmamos e atualizamos updated_at
-- para disparar sincronizacao/refresh nos clientes.

update atendimento_leads
set
  status = coalesce(nullif(status, ''), 'contrato_coletando_dados'),
  funnel_stage = coalesce(nullif(funnel_stage, ''), 'contrato_coletando_dados'),
  recurring_class_status = coalesce(nullif(recurring_class_status, ''), 'confirmado'),
  contract_status = coalesce(nullif(contract_status, ''), 'coletando_dados'),
  updated_at = now()
where id = '1a2fb29f-205b-4395-af57-0f8dcfeaada6'::uuid
  and phone = '15616098367';
