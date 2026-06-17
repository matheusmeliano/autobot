# Debug Session: extra-scheduled-send

- Status: [OPEN]
- Symptom: 6 agendamentos cadastrados resultam em 7 mensagens enviadas; a primeira mensagem extra ocorre em horário diferente dos 6 agendamentos previstos.
- Expected: cada mensagem enviada deve corresponder exatamente a um agendamento elegível/processado.

## Hypotheses

1. Existe um segundo fluxo de envio para a Z-API além do cron principal de agendamentos.
2. O cron está selecionando um agendamento antigo, recorrente ou invisível na lista dos 6 testes.
3. A recorrência mensal ou avanço automático está criando uma execução extra fora da janela esperada.
4. Um retry, lock concorrente ou disparo manual está enviando uma mensagem fora dos 6 horários configurados.
5. O conjunto exibido na UI não corresponde exatamente ao conjunto consultado pelo backend no momento do envio.

## Evidence Plan

1. Localizar todos os pontos de envio para a Z-API.
2. Instrumentar os fluxos candidatos com `schedule_id`, `debtor_id`, `scheduled_for`, `source` e horário local/UTC.
3. Reproduzir o cenário e coletar logs `pre-fix`.
4. Confirmar a hipótese vencedora e aplicar correção mínima.
5. Comparar logs `pre-fix` vs `post-fix` e pedir validação.
