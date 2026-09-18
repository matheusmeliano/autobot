# Debug Session: clientes-popup-save

Status: OPEN

## Sintoma
- Em `https://www.autobot.business/app/clientes`, editar cliente pelo popup/modal nem sempre salva.

## Hipoteses
- A action de update falha para alguns clientes por dados legados em `charges`.
- O frontend monta payload inconsistente em cenarios especificos.
- Existe bloqueio visual/estado no modal que interfere no clique ou submit.
- A sincronizacao entre `debtor_charges` e `schedules` falha em alguns registros.
- Producao diverge do comportamento esperado/local em parte do fluxo de edicao.

## Evidencias
- Pendente.

## Instrumentacao
- Pendente.

## Resultado
- Pendente.
