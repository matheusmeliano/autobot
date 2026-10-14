# Debug Session: dashboard-paid-mismatch
- **Status**: [OPEN]
- **Issue**: Dashboard mostra R$ 1.500,00 em "Já recebidos" embora o pagamento confirmado do mês seja apenas R$ 300,00.
- **Debug Server**: TBD
- **Log File**: .dbg/trae-debug-log-dashboard-paid-mismatch.ndjson

## Reproduction Steps
1. Abrir `/app/clientes` e identificar o cliente marcado como `Pago`.
2. Abrir `/app/dashboard`.
3. Comparar o valor do card `Já recebidos` com a soma efetivamente paga no mês corrente.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | O card usa `status` agregado do devedor e não pagamento efetivo do mês | High | Low | Pending |
| B | O cálculo está contando parcelas acumuladas como recebidas | High | Low | Pending |
| C | Schedules antigos/fechados entram no mês operacional atual | Medium | Medium | Pending |
| D | `clientes` e `dashboard` ainda usam fontes divergentes para schedules/runs | Medium | Low | Pending |
| E | A carga está certa e a UI renderiza o valor errado | Low | Low | Pending |

## Log Evidence
Pending.

## Verification Conclusion
Pending.
