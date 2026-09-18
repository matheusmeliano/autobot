# Debug Session: zapi-webhook-auth
- **Status**: [OPEN]
- **Issue**: A validação de WhatsApp do atendimento público fica presa em estado pendente porque os callbacks da Z-API aparentemente não conseguem concluir a confirmação de entrega.
- **Debug Server**: `.dbg/zapi-webhook-auth.env`
- **Log File**: .dbg/trae-debug-log-zapi-webhook-auth.ndjson

## Reproduction Steps
1. Abrir o atendimento público autenticado.
2. Informar um número de WhatsApp quando o bot solicitar.
3. Observar a mensagem de pendência de validação.
4. Aguardar o envio e a continuação automática do cadastro.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | A rota `api/webhooks/zapi` exige `secret`, mas a URL registrada na Z-API não inclui esse valor. | High | Low | Confirmed |
| B | O webhook é configurado por `sendAtendimentoWhatsAppText()` com endpoint incompleto ou incompatível com o mecanismo de autenticação esperado. | High | Low | Confirmed |
| C | O callback chega, mas o `messageId`/`instanceId` não bate com o evento pendente salvo no atendimento. | Medium | Medium | Pending |
| D | O callback chega com `eventType` diferente do que o código trata para finalizar a validação. | Medium | Medium | Pending |
| E | A configuração de delivery/status não está sendo realmente persistida na Z-API, apesar do retorno `200`. | Medium | Medium | Pending |

## Log Evidence
- Manual POST recente para produção retornou `401 Unauthorized`.
- Novo POST manual para `https://www.autobot.business/api/webhooks/zapi?secret=...` também retornou `401`, o que indica que o segredo usado em produção não está disponível localmente.
- Eventos `phone_validation_pending` foram gravados.
- Não houve novos `DeliveryCallback` ou `MessageStatusCallback` persistidos após o envio de teste.
- A rota [route.ts](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/app/api/webhooks/zapi/route.ts#L19-L27) só autoriza callback com `?secret=` ou header `Bearer`.
- O cadastro do webhook em [server.ts](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/lib/atendimento/server.ts#L202-L219) usava a URL sem `secret`; agora passa a incluir esse parâmetro quando `ZAPI_WEBHOOK_SECRET` estiver definido.
- O `.env` local não contém `ZAPI_WEBHOOK_SECRET`, então a reconfiguração imediata da instância produtiva não pode ser feita daqui com o mesmo valor de produção.
- Após o deploy, entrou um `DeliveryCallback` novo em `whatsapp_events` com `event_id = 3EB07892067420F4001893`.
- O atendimento registrou `phone_validation_failed` com `error = "Phone number does not exist"` para o número `65996933336`.
- A função [normalizePhone](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/lib/atendimento/server.ts#L58-L63) enviava `65996933336` sem prefixar `55`, enquanto a normalização usada no webhook já trata números brasileiros de 11 dígitos com `55`.

## Verification Conclusion
- Correção aplicada: a URL registrada na Z-API agora é montada por `buildAuthorizedZapiWebhookUrl()` e reaproveita o `ZAPI_WEBHOOK_SECRET`.
- Correção aplicada adicional: [normalizePhone](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/lib/atendimento/server.ts#L58-L63) agora prefixa `55` para números brasileiros com 11 dígitos antes do envio à Z-API.
- Verificação local: `npm.cmd run build` concluiu sem erros após a alteração.
- Próxima checagem necessária: subir essa alteração para produção e repetir o fluxo no atendimento público para confirmar chegada do callback e saída do estado pendente.
