# [OPEN] Debug Session: public-whatsapp-callback

## Sintoma
- O bot responde: `Perfeito. Estou validando esse WhatsApp agora. Assim que a entrega for confirmada, continuo seu cadastro automaticamente.`
- Depois de esperar, a mensagem não chega ao WhatsApp informado e o fluxo não avança.

## Esperado
- A mensagem de boas-vindas deve ser enviada ao número informado.
- O callback da Z-API deve confirmar entrega/recebimento e o atendimento deve prosseguir automaticamente.

## Hipóteses Iniciais
- H1. O webhook da instância não foi configurado corretamente e os callbacks de entrega/status não chegam ao app.
- H2. O `send-text` está retornando aceite, mas a mensagem fica presa/falha na fila da Z-API antes de chegar ao WhatsApp.
- H3. O número informado está sendo normalizado de forma incompatível com o envio para o país do lead.
- H4. O callback chega, mas o app não encontra o `messageId` pendente para concluir a validação.
- H5. O envio falha silenciosamente porque a instância do atendimento está desconectada ou com restrição operacional.

## Plano
- Verificar evidências recentes no banco (`whatsapp_events`, histórico do atendimento e mensagens).
- Confirmar se o `messageId` pendente foi gravado e se houve callback correspondente.
- Testar o envio direto na instância e comparar com o comportamento do fluxo público.
- Só então aplicar a correção mínima baseada na evidência.
