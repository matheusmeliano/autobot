# Debug Session: phone-attempt-flow
- **Status**: [OPEN]
- **Issue**: O fluxo público exibe a etapa de CPF após tentativas inválidas de WhatsApp, em vez de insistir no telefone até a 3a falha e então encerrar definitivamente.
- **Debug Server**: Pending
- **Log File**: .dbg/trae-debug-log-phone-attempt-flow.ndjson

## Reproduction Steps
1. Abrir o atendimento público autenticado.
2. Informar um WhatsApp inválido sem DDI aceito ou com formato rejeitado.
3. Repetir a tentativa inválida.
4. Verificar se o bot insiste no telefone ou avança incorretamente para CPF.
5. Repetir até a 3a tentativa e verificar se encerra e bloqueia o chat.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | O CPF ainda aparece porque continua na ordem de captura, então o fluxo avança para ele quando o telefone é tratado como preenchido. | High | Low | Confirmed |
| B | O telefone inválido está sendo salvo ou marcado como pendente cedo demais, contaminando o estado do lead. | High | Medium | Partially confirmed |
| C | O contador de tentativas inválidas não é levado em conta ao escolher a próxima mensagem do bot. | High | Medium | Confirmed |
| D | Algum callback/evento histórico regrava `phone` após falha e faz o fluxo seguir. | Medium | Medium | Not needed |
| E | O backend já responde com CPF e a UI apenas reflete isso corretamente. | Medium | Low | Confirmed |

## Log Evidence
- `CAPTURED_FIELD_ORDER` ainda continha `cpf`, então o próximo campo após `phone` podia avançar para CPF.
- `fieldFromBotPrompt()` só reconhecia prompts exatos do fluxo, mas não reconhecia as mensagens de erro de WhatsApp como continuação da etapa `phone`.
- Em `public/messages/route.ts`, falhas de WhatsApp ainda podiam reaproveitar o fluxo padrão para calcular `defaultBotResponse`, permitindo avanço indevido de etapa.
- A contagem de tentativas no request síncrono considerava apenas `phone_validation_format_failed`, enquanto falhas reais vindas do callback atualizavam `phone_validation_failed`.
- O callback de delivery failure ainda reabria a conversa apenas com mensagem de erro, sem encerrar automaticamente na 3a falha.

## Verification Conclusion
- CPF removido completamente da ordem de captura e dos prompts do pré-cadastro.
- Falhas de telefone agora mantêm o fluxo preso em `phone` até validar ou encerrar.
- A 3a falha, seja por formato/rejeição imediata ou callback de entrega, encerra a conversa definitivamente e desativa `bot_enabled`.
- A UI pública passa a refrescar a sessão ao receber mensagem do bot, refletindo o bloqueio do composer sem precisar recarregar a página.
- Validação local concluída com sucesso em `node --test src/lib/atendimento/bot.test.ts` e `npm.cmd run build`.
