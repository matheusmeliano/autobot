[OPEN]

# Debug Session: agendar-manual-payment

## Sintoma
- Em `app/agendar`, ao clicar manualmente em `Pagamento realizado`, alguns itens que deveriam ficar como `Executado / Pago` nao refletem esse estado corretamente.

## Esperado
- Se um item estiver `Agendado` ou `Executado / Nao pago` e o usuario clicar em `Pagamento realizado`, ele deve aparecer como `Executado / Pago`.

## Hipoteses
- H1: A action manual grava os dados, mas a regra visual continua calculando o status pelo ciclo errado.
- H2: Em recorrencia, a liquidacao manual avanca o agendamento e perde a referencia paga do mes corrente.
- H3: O reload de `app/agendar` recompõe a linha com campos diferentes dos usados imediatamente apos a action.
- H4: Outro fluxo posterior, como cron ou sincronizacao de configuracoes, sobrescreve os campos relevantes logo depois do clique.

## Evidencias
- Pendente.

## Instrumentacao
- Pendente.

## Conclusao
- Pendente.
