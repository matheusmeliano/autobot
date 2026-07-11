# Debug Session: whatsapp-false-success
- **Status**: [OPEN]
- **Issue**: O sistema mostra "WhatsApp registrado com sucesso" mesmo quando a mensagem de validacao/boas-vindas nao chegou no WhatsApp real.
- **Debug Server**: http://127.0.0.1:7778/event
- **Log File**: .dbg/trae-debug-log-whatsapp-false-success.ndjson

## Reproduction Steps
1. Abrir o atendimento publico.
2. Informar o telefone.
3. Confirmar com "sim".
4. Aguardar a etapa "Perfeito! Estou validando seu WhatsApp. Aguarde um instante."
5. Verificar se a mensagem realmente chega no WhatsApp.
6. Verificar se o chat mostra "WhatsApp registrado com sucesso..." mesmo sem a entrega real.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | O envio inicial para a Z-API retorna sucesso/callback sem entrega real ao WhatsApp. | High | Med | Supported |
| B | O webhook confirma `phone_validated` cedo demais com base em callback insuficiente. | High | Low | Confirmed |
| C | O callback positivo esta sendo correlacionado com a mensagem errada. | Med | Med | Pending |
| D | O telefone enviado para Z-API esta normalizado de forma aceita pela API, mas invalida para entrega real. | Med | Low | Pending |

## Log Evidence
- Evidencia anterior do projeto mostrou que o fluxo passou a confirmar com `DeliveryCallback` sem erro.
- A reproducao atual confirmou o sintoma de falso sucesso: sem mensagem real entregue, mas com transicao para `phone_validated`.
- A funcao de timeout tecnico existia, mas nao estava sendo chamada no `GET` de mensagens publicas.
- Instrumentacao ativa em:
  - `src/app/api/atendimento/public/messages/route.ts`
  - `src/app/api/webhooks/zapi/route.ts`

## Verification Conclusion
- Fix em validacao:
  - confirmar `phone_validated` apenas com `MessageStatusCallback` em `RECEIVED/READ`
  - acionar timeout tecnico pendente no `GET` de mensagens publicas
