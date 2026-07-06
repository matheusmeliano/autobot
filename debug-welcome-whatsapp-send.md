# Debug Session: welcome-whatsapp-send
- **Status**: [OPEN]
- **Issue**: Mensagem de boas-vindas do ramo do `SIM` não chega ao WhatsApp informado pelo lead.
- **Debug Server**: `.dbg/welcome-whatsapp-send.env`
- **Log File**: `.dbg/trae-debug-log-welcome-whatsapp-send.ndjson`

## Reproduction Steps
1. Abrir o fluxo publico de atendimento.
2. Informar um numero de WhatsApp valido em formato numerico aceito.
3. Confirmar o numero com uma resposta positiva na etapa de confirmacao.
4. Verificar se a mensagem de boas-vindas chega ao WhatsApp informado.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | O ramo do `SIM` nao chega a executar o envio porque `pendingPhone` esta vazio ou divergente. | High | Low | Pending |
| B | O envio inicia, mas falha na configuracao de webhook/base URL ou no request para a Z-API. | High | Medium | Pending |
| C | A configuracao da instancia WhatsApp e rejeitada em runtime, impedindo o envio. | Medium | Low | Pending |
| D | O telefone e persistido/capturado corretamente, mas e normalizado para um valor incorreto no `send-text`. | Medium | Low | Pending |
| E | A Z-API aceita ou retorna payload inesperado, e o sistema classifica errado o resultado do envio. | Medium | Medium | Pending |

## Log Evidence
- `atendimento_history_events` registrou `phone_confirmation_confirmed` seguido de `phone_confirmation_whatsapp_sent` para a conversa `75a714f3-ce0e-4d9b-bd20-4e2109032b48`, com `messageId = 9F5E3F9F6C94B34835BB` e `zaapId = 019F3906B902733B880487308952E7D5`.
- `whatsapp_events` nao possui qualquer callback para esse `messageId`, nem eventos novos apos `2026-07-06T19:55:00+00:00`, o que descarta entrega confirmada e aponta ausencia de retorno do provider.
- A instancia `3F4637B99226817E084AFAED5EA750A2` esta salva no banco com status `configured`, mas a consulta direta `GET /instances/{instanceId}/token/{token}/me` retornou `connected: false`.
- A Z-API manteve corretamente todos os callback URLs apontando para `https://www.autobot.business/api/webhooks/zapi?secret=...` e `receiveCallbackSentByMe: true`, entao o problema atual nao e URL de webhook ausente.
- O codigo classificava sucesso somente pela presenca de `id/messageId/zaapId` na resposta inicial do `send-text`, sem validar a conectividade real da instancia antes do envio.

## Verification Conclusion
- Hipotese A: rejeitada. O ramo do `SIM` executou e o `pendingPhone` foi persistido corretamente.
- Hipotese B: rejeitada para configuracao de webhook. A URL registrada na Z-API esta correta e com `secret`.
- Hipotese C: confirmada. A instancia esta desconectada em runtime, apesar do banco ainda indicar `configured`.
- Hipotese D: nao confirmada. O telefone salvo e enviado foi `5565996933336`, consistente entre lead e historico.
- Hipotese E: confirmada. O sistema marcava falso positivo de envio por aceitar apenas o payload inicial da Z-API.
- Correcao aplicada: `sendAtendimentoWhatsAppText()` agora consulta `GET /me` antes de enviar e aborta com erro explicito quando `connected` for `false`, evitando marcar envio falso como sucesso.
