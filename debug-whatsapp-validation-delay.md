[OPEN] Debug session: whatsapp-validation-delay

## Sintoma
- O usuario confirma o telefone no atendimento publico.
- O sistema informa que esta validando o WhatsApp.
- Mesmo apos alguns minutos, a mensagem de validacao nao chega.

## Hipoteses
1. O envio para a Z-API retorna sucesso HTTP, mas sem identificador correlacionavel.
2. O evento `phone_validation_pending` esta sendo salvo sem os IDs necessarios.
3. O webhook recebe callback com IDs em outro formato/campo e nao encontra o pending.
4. O webhook da instancia nao esta configurado corretamente ou esta sendo rejeitado na autorizacao.

## Plano de evidencia
1. Instrumentar o ponto de envio em `public/messages`.
2. Confirmar como o pending e salvo.
3. Ler os logs do webhook para match/miss.
4. Corrigir somente depois da evidencia.

## Evidencia coletada
- O evento `phone_validation_pending` foi criado corretamente no banco com:
  - `external_message_id = 95EB25C8E38449B681CB`
  - `external_zaap_id = 019F522301637E8099A2AF0692CAB636`
- O webhook recebeu callbacks para o mesmo envio:
  - `DeliveryCallback` sem erro
  - `MessageStatusCallback` com status `SENT`
- O fluxo anterior so confirmava a validacao em `MessageStatusCallback` com `RECEIVED` ou `READ`.
- Resultado: o callback positivo chegava, mas o atendimento permanecia preso em `phone_validation_pending`.

## Correcao aplicada
- O webhook agora tambem confirma a validacao quando recebe `DeliveryCallback` sem erro.
- Mantive a confirmacao por `RECEIVED/READ` para os casos em que esses status continuarem chegando.
