# Debug Session: whatsapp-validation-send
- **Status**: [OPEN]
- **Issue**: A etapa `Perfeito! Estou validando seu WhatsApp. Aguarde um instante.` deve continuar sendo usada, mas a mensagem real nao esta chegando no numero validado.
- **Connected Number**: `65999495594`
- **Validation Target**: `65996933336`

## Reproduction Steps
1. Abrir o atendimento publico.
2. Informar o telefone `65996933336`.
3. Confirmar com `sim`.
4. Verificar a exibicao da mensagem `Perfeito! Estou validando seu WhatsApp. Aguarde um instante.`.
5. Verificar se a mensagem real chega no WhatsApp `65996933336`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | O `sendAtendimentoWhatsAppText` esta retornando aceite superficial da Z-API, sem entregar de fato para o numero alvo. | High | Low | Pending |
| B | O fluxo publico nao esta persistindo/correlacionando corretamente os IDs externos do envio para concluir a validacao. | High | Med | Pending |
| C | O callback da Z-API esta chegando em formato diferente do esperado para esse teste especifico. | High | Med | Pending |
| D | O numero esta sendo normalizado em formato aceito pela API, mas incorreto para entrega real. | Med | Low | Pending |

## Evidence
- Ambiente real consultado via Supabase mostrou em `2026-07-11T23:11:46Z` o evento `phone_confirmation_whatsapp_sent` para o telefone `65996933336`, com payload retornando:
  - `messageId`: `FA4459C732F91F65DD02`
  - `zaapId`: `019F53737FA97F3BBBF55D09FD73A2C6`
- A mesma conversa recebeu logo depois a mensagem interna `WhatsApp registrado com sucesso...`, provando que o fluxo atual estava promovendo sucesso logo apos o `send-text`, sem aguardar callback.
- O `whatsapp_events` remoto registrou para a mesma mensagem um `MessageStatusCallback` com `status: SENT` em `2026-07-11T23:11:51Z`.
- O webhook em producao ainda estava retornando `callback_not_used_for_phone_validation`, entao o callback valido estava sendo ignorado.

## Confirmed Root Cause
- O fluxo restaurado anteriormente em `main` voltou a tratar o aceite inicial da Z-API como sucesso final.
- Isso removeu a etapa intermediaria `Perfeito! Estou validando seu WhatsApp. Aguarde um instante.` e deixou a validacao desacoplada do callback real.
- Como o callback `SENT` efetivamente chega depois, a validacao correta precisa voltar para o modelo:
  - `phone_validation_pending` no endpoint publico;
  - correlacao por `messageId/zaapId`;
  - conclusao no webhook ao receber callback valido.

## Fix Applied Locally
- `src/app/api/atendimento/public/messages/route.ts`
  - voltou a usar `WHATSAPP_PENDING_MESSAGE`;
  - persiste `phone_validation_pending` com `external_message_id` e `external_zaap_id`;
  - nao promove mais o lead para sucesso final imediatamente apos o `send-text`.
- `src/app/api/webhooks/zapi/route.ts`
  - voltou a correlacionar callbacks com `phone_validation_pending`;
  - confirma a validacao quando chega `DeliveryCallback` sem erro ou `MessageStatusCallback` com `SENT`, `RECEIVED` ou `READ`;
  - grava `phone_validated` e so entao envia a mensagem final `WhatsApp registrado com sucesso...`.

## Validation
- `npm.cmd run check` OK.
