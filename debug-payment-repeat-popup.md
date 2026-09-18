[OPEN]

# Debug Session: payment-repeat-popup

## Sintoma
- Em `Agendamentos`, ao clicar novamente em `Pagamento realizado`, o sistema ainda abre a confirmação de quitar a mensalidade em vez de avisar que ela já foi processada.

## Esperado
- Ao clicar novamente em um agendamento já quitado/processado, o sistema deve informar claramente que a cobrança do mês de referência já foi marcada como paga.

## Hipóteses
- A: A linha renderizada volta do backend com `status = agendado` após o pagamento.
- B: O schedule pago é diferente do schedule exibido na listagem do mês atual.
- C: O fechamento/avanço da recorrência cria a próxima cobrança, mas a reconstrução da linha reaproveita dados do mês atual como se ainda estivessem abertos.
- D: O botão considera apenas `status` e ignora outro marcador de pagamento já confirmado.

## Evidências
- Pendente.

## Instrumentação
- Pendente.

## Conclusão
- Pendente.
