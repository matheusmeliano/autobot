# [OPEN] Debug Session: public-whatsapp-send

## Sintoma
- O bot informa `WhatsApp registrado com sucesso`, mas a mensagem de boas-vindas não chega ao número informado no atendimento público.

## Esperado
- A mensagem de boas-vindas deve ser realmente enviada ao WhatsApp informado.
- O número só pode ser salvo e confirmado após evidência de envio aceito/entregue.

## Hipóteses Iniciais
- H1. A Z-API responde `200`, mas o payload indica falha silenciosa ou ausência de enfileiramento.
- H2. O número está sendo normalizado em formato incompatível com o envio para WhatsApp internacional.
- H3. O fluxo usa a instância/token corretos, mas a Z-API exige outro endpoint/cabeçalho para esse tipo de envio.
- H4. O backend salva o telefone com base em um critério de sucesso fraco antes da confirmação real do envio.
- H5. O envio ocorre, mas para outro número devido a transformação incorreta do telefone recebido no chat.

## Plano
- Instrumentar o fluxo de validação do WhatsApp com logs estruturados.
- Reproduzir o problema e coletar evidências da requisição/resposta.
- Confirmar ou descartar hipóteses com base nos logs.
- Só então aplicar a correção mínima.

## Evidências Coletadas
- E1. O envio direto pela mesma instância do atendimento retornou `200` com `zaapId`, `messageId` e `id`, então a instância consegue aceitar envios.
- E2. A tabela `whatsapp_events` continha apenas `ReceivedCallback|RECEIVED|other` nas últimas 500 entradas; não havia `DeliveryCallback` nem `MessageStatusCallback` para mensagens enviadas pela instância.
- E3. A documentação atual da Z-API separa:
  - aceite/envio inicial;
  - callback de delivery para processamento da mensagem pela instância;
  - callback de status (`RECEIVED`/`READ`) para confirmação de recebimento/leitura pelo destinatário.

## Hipóteses
- H1. A Z-API responde `200`, mas o payload indica falha silenciosa ou ausência de enfileiramento. `DESCARTADA`
- H2. O número está sendo normalizado em formato incompatível com o envio para WhatsApp internacional. `NÃO CONFIRMADA`
- H3. O fluxo usa a instância/token corretos, mas a Z-API exige outro endpoint/cabeçalho para esse tipo de envio. `DESCARTADA`
- H4. O backend salva o telefone com base em um critério de sucesso fraco antes da confirmação real do envio. `CONFIRMADA`
- H5. O envio ocorre, mas para outro número devido a transformação incorreta do telefone recebido no chat. `AINDA NÃO CONFIRMADA`

## Correção Aplicada
- O envio da mensagem de validação agora configura os webhooks da instância para o endpoint `zapi`.
- O atendimento público não salva mais `lead.phone` no aceite inicial.
- O número fica em estado pendente até o webhook confirmar:
  - `DeliveryCallback` com erro -> reprova e pede outro WhatsApp.
  - `MessageStatusCallback` com `RECEIVED`/`READ` -> salva o telefone, registra sucesso e segue para a próxima pergunta do pré-cadastro.

## Status
- `[OPEN]` aguardando validação do usuário em ambiente real.
