[OPEN]

# Debug Session: adriano-status-executado

## Sintoma
- Em `/app/agendar`, `Adriano Construtor` aparece com vencimento `10/06/2026` e status `Executado`, embora a regra esperada seja considerar que ele nao tem registro valido em `10/06` como referencia para `Clientes` e deveria aparecer como `Agendado`.

## Esperado
- A linha exibida em `Agendamentos` deve respeitar a referencia correta da cobranca/agendamento do Adriano e nao marcar `Executado` quando essa referencia estiver incorreta.

## Hipoteses
- A: A UI ainda recebe uma linha montada com `charge_due_at` em `10/06/2026`.
- B: O fallback de associacao entre `debtor_charges` e `schedules` continua casando um registro indevido para o Adriano.
- C: O calculo visual de status em `SchedulesClient` marca `Executado` sem validar se a referencia escolhida para o Adriano eh a correta.
- D: Existe um registro legado no banco para o Adriano que continua influenciando a linha aberta em `Agendamentos`.

## Evidencias
- Pendente.

## Instrumentacao
- Pendente.

## Conclusao
- Pendente.
