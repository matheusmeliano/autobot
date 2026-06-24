# Debug Session: executed-still-agendado
- **Status**: [OPEN]
- **Issue**: Arts Car Recuperacao Automotiva teve 2 agendamentos executados pelo bot, mas a tela de Agendamentos ainda mostra status como Agendado.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-executed-still-agendado.ndjson

## Reproduction Steps
1. Abrir `Agendamentos`.
2. Localizar `Arts Car Recuperacao Automotiva`.
3. Comparar o status exibido na UI com os registros de execucao do bot.
4. Verificar se os 2 agendamentos enviados continuam como `Agendado`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | `schedule_runs` existe, mas nao eh associado ao `schedule_id` exibido na tela. | High | Med | Rejected |
| B | A linha exibida na agenda foi montada a partir de outra cobranca/schedule do mesmo cliente. | High | Med | Rejected |
| C | `displayStatus()` recebe dados corretos, mas decide `Agendado` por erro de regra. | Med | Med | Confirmed |
| D | O backend consulta um estado parcial e nao traz o ultimo envio executado. | Med | Med | Rejected |
| E | Existe duplicidade de agendamentos/cobrancas e a UI mostra a linha nao executada. | Med | Med | Rejected |

## Log Evidence
- Consulta direta ao Supabase mostrou 2 `schedules` do cliente `Arts Car Recuperacao Automotiva`, ambas com `status: "pendente"` e `last_sent_at: "2026-06-24T13:00:34.716+00:00"`.
- A mesma consulta mostrou 2 `schedule_runs` com `status: "executado"` para os mesmos `schedule_id` e `scheduled_for: "2026-06-24T13:00:00+00:00"`.
- Isso prova que a execucao foi registrada corretamente, mas a UI ainda podia mostrar `Agendado` porque a regra visual nao considerava `last_executed_scheduled_for` para a instancia atual.
- Instrumentacao adicionada em `agendaRows.ts` e `SchedulesClient.tsx` para registrar montagem da linha e calculo do status visual durante a verificacao.

## Verification Conclusion
- Pre-fix: uma instancia executada no mesmo dia permanecia visualmente como `Agendado` quando a `schedule` continuava com `status: "pendente"`.
- Fix aplicado: `SchedulesClient.tsx` agora considera a instancia como executada quando `last_executed_scheduled_for` corresponde ao `data_envio` atual, ou quando o status ja estiver `executado`/`pago`.
- Post-fix: a mesma linha deve aparecer como `Executado` imediatamente apos o envio registrado em `schedule_runs`, sem depender de virar o dia.
