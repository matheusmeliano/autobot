# Debug Session: us-whatsapp-send
- **Status**: [OPEN]
- **Issue**: O bot não consegue validar/enviar mensagem para números dos EUA com DDI `+1`, mesmo com formatos diferentes do mesmo número.
- **Debug Server**: Pending
- **Log File**: .dbg/trae-debug-log-us-whatsapp-send.ndjson

## Reproduction Steps
1. Abrir o atendimento público autenticado.
2. Informar um número dos EUA no campo de WhatsApp.
3. Aguardar a validação do envio.
4. Verificar se a mensagem chega e se o fluxo continua.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | A normalização do telefone altera incorretamente o número dos EUA antes do envio. | High | Low | Confirmed |
| B | A extração/captura do campo `phone` remove ou corrompe o `+1` antes de chamar o envio. | High | Medium | Rejected |
| C | A Z-API recebe o número corretamente, mas devolve erro específico para DDI `+1`. | Medium | Medium | Rejected |
| D | O callback grava um erro genérico e mascara a causa real para números internacionais. | Medium | Medium | Rejected |
| E | O número salvo no evento pendente não bate com o número efetivamente enviado. | Medium | Medium | Confirmed |

## Log Evidence
- `phone_validation_failed` recente para `+1 (857) 888-4662` foi gravado com `error = "Phone number does not exist"`.
- O `DeliveryCallback` correspondente entrou em `whatsapp_events` com `phone = "5518578884662"` e `messageId = "D4A005FF305E35DDDC3F"`.
- Isso prova que o número dos EUA foi alterado antes do envio, porque o correto seria `18578884662`, não `5518578884662`.
- A mesma distorção apareceu em outro número com DDI `+1`: `+1 321 297 3565` chegou ao callback como `5513212973565`.
- A função [normalizePhone](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/lib/atendimento/server.ts#L58-L65) adicionava `55` a qualquer número com `11` dígitos que não começasse com `55`.

## Verification Conclusion
- Correção aplicada localmente: a normalização agora preserva números com `+` explícito e também `1XXXXXXXXXX` antes de considerar o prefixo `55`.
- Ajustei os pontos equivalentes em [server.ts](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/lib/atendimento/server.ts#L58-L65), [route.ts](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/app/api/webhooks/zapi/route.ts#L46-L55), [actions.ts](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/app/app/agenda/actions.ts#L81-L90) e [route.ts](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/app/api/cron/schedules/route.ts#L50-L59).
- Verificação local: `npm.cmd run build` concluiu sem erros.
- Próxima validação necessária: publicar a correção e repetir o teste com `+1 (857) 888-4662`.
