# Plano: Reconhecimento Amplo de Localidades (Vilas, Vilarejos, Distritos, Colonias etc.)

## Repository Research

### Arquitetura atual de localidades

O sistema NÃO consulta APIs externas de geocodificação (Google Maps, MapBox, Nominatim etc.) com classificação `place_type = city/town/...`. Toda inferência é **baseada em regras e keywords** em arquivos locais do repositório, usando três camadas principais.

#### 1. Base de conhecimento estática
- **`CITY_TIME_ZONE_RULES`** em `src/lib/timezone.ts:102-2019`: ~1900 linhas de regras por timezone, separadas por país (BR/US). Cada regra tem: `{ timeZone, country, keywords: [localidades...], stateKeywords: [estado/ufs...] }`. A lista `keywords` é usada tanto para CIDADES quanto para qualquer outro rótulo de lugar conhecido; mas ela foi historicamente preenchida APENAS com nomes de municípios, excluindo vilas, vilarejos, distritos, colonias, townships, gated communities etc.

#### 2. Funções de resolução de cidade e estado (não existe filtro `place_type == city`)
- **`resolveTimeZoneFromCityInput()`** em `src/lib/timezone.ts:2382-2522`:
  1. Match de cidade em `CITY_TIME_ZONE_RULES[i].keywords`;
  2. Fallback por estado (`state_match`);
  3. Fallback por telefone DDD/prefixo (`phone_country_fallback`).
- **Importante**: NÃO há nenhuma condição `if place_type !== city` no código. O único filtro de "reconhecimento" é: o nome da localidade estar na lista de `keywords` da regra do timezone correspondente.
- **`cityResolutionIsReliable()`** em `src/app/api/webhooks/zapi/route.ts:681-702`: exige source === "city_match" (match direto em keywords) OU "state_match". Rejeita `phone_country_fallback` (pois não há cidade identificada).

#### 3. Fluxos chamadores (onde a lógica é aplicada)
| Fluxo | Entry point | Quem valida |
|---|---|---|
| **Bot WhatsApp (conversa)** | `src/app/api/webhooks/zapi/route.ts:5291-5450` | `isValidCityInput → resolveTimeZoneFromCityInput(allowPhoneCountryFallback=false) → cityResolutionIsReliable()`. Após 3 falhas bloqueia e pede suporte. |
| **Busca/inclusão manual painel** | `src/components/app/atendimento/AtendimentoClient.tsx:3033-3070` (handleSaveEditLocationSelected) → `src/app/api/atendimento/leads/[leadId]/route.ts:790-819` | **NÃO VALIDA NADA!** O modal só aceita dois textos livres e faz UPDATE direto. O Zod schema só limita tamanho. Ou seja: no painel manual o bug é **aparentemente possível incluir qualquer coisa**. Mas em telas que exibem a timezone horária do lead (como seleção de horário de aula) é chamado `resolveTimeZoneFromCityInput({city,state})` → se a localidade não estiver em keywords, não resolve timezone → exibe fallback por estado ou por TZ do país/telefone. |
| **Cadastro recorrente público** | `src/app/cadastro/recorrente/client.tsx:1246-1275` (handleAdvance1) | `resolveStudentTimezone({city,state,browserTz})` → resolveTimeZoneFromCityInput → se falhar usa browserTz como fallback (menos restritivo que WhatsApp). |
| **Resumo do card na lista** | `buildExperimentalMetaForList` → `deriveLeadEffectiveTimeZone` → usa `lead.timezone` persistido (não resolve em runtime). |

### Conclusão da pesquisa: Onde está o "filtro de apenas cidades"?
- **Root cause 1 (mais importante):** `CITY_TIME_ZONE_RULES.keywords` está historicamente preenchida só com nomes de **municípios oficialmente classificados como "cidade"** (pelo IBGE para BR, Census para US). Nomes de **vilas / vilarejos / villages / towns / townships / cidades-distrito / distritos / planned / gated communities / colonias da fronteira México** NÃO estão na lista de keywords → `resolveTimeZoneFromCityInput()` retorna null → WhatsApp rejeita por 3 tentativas e bloqueia; cadastro recorrente cai em browserTz.
- **Root cause 2 (gate no WhatsApp):** `cityResolutionIsReliable()` rejeita `phone_country_fallback`, então o fallback de telefone NÃO permite salvar a cidade; só salva se o estado for reconhecido.
- **Root cause 3 (gate no WhatsApp):** `allowPhoneCountryFallback=false` em `resolveTimeZoneFromCityInput()` (linha 5304) — impossibilita o fallback mais amplo de timezone por país.
- **Root cause 4 (manual painel não tem busca):** não existe autocomplete/busca assistida de localidades; só campo texto livre. O usuário inseriu manualmente no modal e a timezone não foi resolvida → horários das aulas calculados com timezone errada ou vazia.

## Arquivos e Módulos

### Arquivos a alterar
1. **`src/lib/timezone.ts`** (arquivo único ~2500 linhas)
   - Adicionar seções auxiliares **fora da lista principal `CITY_TIME_ZONE_RULES`**:
     - Constante `LOCALITY_TYPES_TO_INCLUDE` (lista de palavras-chave estruturais que classificam a localidade como "habitada" e válida: vila, vilarejo, village, town, township, distrito, colonia, colonia, comunidad, comunidad cerrada, condominio, condominio fechado, planned community, gated community, cidade distrito, distrito-municipal, neighborhood em fronteira MX etc. em PT-BR, EN, ES).
     - Mapa **ampliado** `EXTENDED_LOCALITIES_BY_STATE_KEY: Record<stateKeyword, string[]>` contendo:
       - **BR**: lista por estado (UF) de distritos, vilas, vilarejos, cidades-distrito, comunidades planejadas, condomínios fechados de cada estado (base em censo IBGE 2022 por município/estado, + colônias da fronteira do Acre/Roraima/Amazonas e BR com países vizinhos).
       - **US**: lista por estado (nome completo ou UF sigla) de towns, townships, villages, census-designated places, planned communities, gated communities.
       - **Fronteira MX-EUA e colonias do Texas / Novo México**: lista de colonias (Texas colonias listadas em HUD) como El Paso area colonias, colonias de Webb, Hidalgo, Starr, Maverick, Hudspeth counties; colonias de Nuevo México (Doña Ana county, Otero county, Luna county).
     - Função `amendCityTimeZoneRulesWithExtendedLocalities(baseRules: CityTimeZoneRule[]): CityTimeZoneRule[]` — "pós-processamento": pega a base atual e, para cada regra (estado + timezone determinístico), **appenda** as keywords adicionais do mapa ampliado.
   - Modificar inicialização de `CITY_TIME_ZONE_RULES` para rodar `amendCityTimeZoneRulesWithExtendedLocalities` após declaração (criando a variável **final** `_EXTENDED_CITY_TIME_ZONE_RULES` e exportando um alias).
   - Em `resolveTimeZoneFromCityInput()` (2382-2522): substituir todas as referências ao array original para a versão **extendida + amendada**.
   - `extractLocationCandidates()` + `normalizeLocationText()`: adicionar regras para remover / preservar tokens estruturais; se a entrada contiver qualquer um de LOCALITY_TYPES_TO_INCLUDE (substantivo de tipo), considerar o restante como nome de localidade e NÃO rejeitar por tokens longos ou dígitos em excesso.
   - `isValidCityInput()` equivalente no fluxo bot: a função `resolveTimeZoneFromCityInput` atualmente rejeita entradas com `rawCityTokens.length > 8` (linha 2393); ajustar para ser mais permissiva (ex.: 14 tokens) quando o texto conter substantivos de tipo estrutural do mapa, pois "Vila Maria Helena da Conceição de Minas" legítimo.
   - `locationMatchesKeyword()` e `candidateMatchesKeyword`: match parcial "prefixo de nome de distrito" compatível (ex.: "Distrito Federal" diferente de "Brasília DF" — o DF já é estado, mas vilas dentro de municípios podem ser "Vila X de Y").

2. **`src/app/api/webhooks/zapi/route.ts`** (fluxo WhatsApp)
   - `isValidCityInput()` (linha 659): ajustar regras para permissivamente aceitar mais caracteres se conter `LOCALITY_TYPES`; evitar bloquear entradas do tipo "Colonia Hidalgo - El Paso TX".
   - `cityResolutionIsReliable()` (linha 681-702): **adicionar uma nova fonte aceita** — além de `city_match` e `state_match`, aceitar também um novo source `"extended_locality_match"` (retornado por resolveTimeZoneFromCityInput quando o match ocorre no mapa ampliado `EXTENDED_LOCALITIES_BY_STATE_KEY`, ou seja: quando uma localidade "não cidade oficial" é encontrada). Porque queremos que vilas / distritos / colonias sejam salvos sem fallback.
   - Bloco de validação WhatsApp (5291-5307): tentar primeiro `resolveTimeZoneFromCityInput` normal; se falhar, **uma segunda tentativa** com `allowPhoneCountryFallback=true` mas APENAS quando houver nome de tipo estrutural presente (ex.: contém "Colonia" no texto). Se essa segunda tentativa retornar timezone e país, aceitar e marcar source = `"extended_locality_match"` com cidade = entrada limpa.
   - Mensagens de erro `LOCATION_CITY_INVALID_MESSAGE` em `constants.ts`: **OPCIONAL** alterar o texto para ser mais genérico "Não conseguimos identificar a localidade informada" em vez de "cidade". Mas isso é UI e não essencial para o comportamento; só se o cliente pedir.

3. **`src/components/app/atendimento/AtendimentoClient.tsx`** (Modal editar localização manual)
   - Hoje: 2 inputs `<input type="text">` com placeholder "Cidade" (AtendimentoClient.tsx:3662-3672), nenhuma validação no client, e UPDATE direto via PATCH sem resolver timezone no server.
   - Ajuste (isolado): adicionar **validação leve e resolver timezone no server antes do UPDATE**.
     - No `handleSaveEditLocationSelected()` (linha 3040): ANTES do fetch, disparar `resolveStudentTimezone({city, state, phone, browserTimeZone})` e, se resultar timezone diferente de nulo, incluir `timezone` e `country` calculados no corpo do PATCH → persistir no banco o timezone correto da localidade.
     - Se `resolveTimeZoneFromCityInput` retornar uma resolução (mesmo que `extended_locality_match`), normalizar `city` e `state` para os valores retornados (capitalização, normalização de acentos etc.) antes do envio.

4. **`src/app/api/atendimento/leads/[leadId]/route.ts`** (PATCH do lead)
   - Linhas 790-819 (atualização de localidade pura): hoje recebe `city` e `state` e faz UPDATE direto. **Adicionar fallback server-side:** se o request NÃO vier com `timezone` e `country` (ex.: algum client legado que não implementou a resolução), calcular timezone via `resolveTimeZoneFromCityInput` com `allowPhoneCountryFallback=true` — e usar para salvar sempre.
   - Se a cidade não for reconhecida e não houver timezone nenhuma: **ainda aceitar a cidade como texto livre**, mas atribuir timezone via estado (resolveTimeZoneFromStateInput) → pelo menos as aulas são calculadas no fuso do estado, sem horário totalmente errado. **Não rejeitar UPDATE de localidade manual nunca**, o cliente pediu aceitar localidades habitadas em geral.

5. **`src/lib/atendimento/bot.test.ts`** (testes)
   - Adicionar 4-6 casos de teste para: vila BR (ex.: "Vila Maria Helena, SP"), distrito BR (ex.: "Distrito Federal — realmente já é estado então melhor "Plano Piloto, DF"), town US (ex.: "Westfield NJ"), township US (ex.: "Edison Township NJ"), gated community FL (ex.: "The Villages FL"), colonia fronteira TX (ex.: "Socorro - El Paso TX" — colonia registrada). Assert `resolution.source` = `city_match` OU novo `extended_locality_match`, com `city`, `state`, `timeZone` e `country` corretos.
   - Adicionar 1-2 casos de WhatsApp simulation: cidade com "Colônia" no texto e 3 tokens acima do limite antigo → deve passar `isValidCityInput`.

## Implementation Steps

### Step 0 (segurança): Criar snapshot do `CITY_TIME_ZONE_RULES` original (função pura)
1. Criar função `getOriginalCityTimeZoneRules()` que retorna o array literal atual SEM modificações (nenhuma edição in-place).
2. Declarar o array literal em uma função exportável; então inicializar `BASE_CITY_TIME_ZONE_RULES = getOriginalCityTimeZoneRules()`.

### Step 1: Mapa ampliado de localidades por estado
1. Em `src/lib/timezone.ts`, criar blocos de comentário claramente separados por país: **BR Extended**, **US Extended**, **MX-EUA Border (Colonias)**.
2. Popular EXTENDED_LOCALITIES_BY_STATE_KEY com listas iniciais:
   - **BR**: primeiros 200 distritos / vilas mais populosos por estado, cruzados com IBGE censo 2022, por timezone (america_sao_paulo, fortaleza, belem, manaus, cuiaba, campo_grande, porto_velho, rio_branco).
   - **US**: principais Census Designated Places (≥5k pop) + towns/townships + 100 principais gated/planned communities por estado da lista de Wikipedia de acordo com timezone (new_york, chicago, denver, phoenix, los_angeles, anchorage, honolulu, chicago texas, chicago florida panhandle).
   - **Colônias fronteiriças**: HUD Texas Colonias list + New Mexico Colonias list, agregadas como "Colonia [Nome]" + cidade proxima + estado + county.
3. Para cada item, garantir que `stateKeyword` existe no `BASE_CITY_TIME_ZONE_RULES[i].stateKeywords` correspondente (se não, adicionar aos stateKeywords também).

### Step 2: amend() e array extendido
1. Implementar `amendCityTimeZoneRulesWithExtendedLocalities(base)`: deep copy base rules, percorrer EXTENDED_LOCALITIES_BY_STATE_KEY e append keywords às regras de stateKeyword correspondente (sem duplicatas).
2. Criar variável exportável final `CITY_TIME_ZONE_RULES_EXTENDED` = amend aplicado.
3. **Substituir todas as referências** no mesmo arquivo timezone.ts que atualmente usam `CITY_TIME_ZONE_RULES` (ex.: `resolveTimeZoneFromCityInput`, `resolveTimeZoneFromStateInput`, lookupUsStateByCandidate combinado, `inferBrazilianLocationFromDdd` não usa) → apontar para estendida.

### Step 3: Ajustes nas funções de parsing
1. `normalizeLocationText`: preservar hífen, apóstrofo (ingles), vogais acentuadas.
2. `extractLocationCandidates`: gerar 2 variantes a mais quando a entrada contiver "Vila ", "Distrito " etc.: (a) com o prefixo estrutural incluso; (b) sem o prefixo, para match caso a keyword não inclua o prefixo.
3. `resolveTimeZoneFromCityInput`:
   - Aumentar `rawCityTokens.length > 8` para `> 13` (aceita nomes longos).
   - Quando match ocorre em uma keyword que veio do EXTENDED map, retorna source = `"extended_locality_match"` em vez de `"city_match"`. Para isso adicionar um `Set<string> EXTENDED_KEYWORDS = flatten(EXTENDED_LOCALITIES_BY_STATE_KEY)`; após match, se `matchedCityLabel in EXTENDED_KEYWORDS` → novo source.

### Step 4: WhatsApp gates flexibilizados
1. `isValidCityInput()` (zapi:659): quando o texto contém qualquer token de `LOCALITY_TYPES_TO_INCLUDE`, liberar regras:
   - Não rejeitar por "baixa proporção vogais".
   - Permitir até 18 tokens.
   - Aceitar dígitos (ex.: "Rua 15 de Novembro" não é cidade, mas "Colônia 4 de Março" pode ser nome de colonia).
2. `cityResolutionIsReliable()` (zapi:681): incluir `"extended_locality_match"` como source confiável.
3. Bloco validação WhatsApp (5291):
   - 1ª tentativa normal.
   - Se falhar E texto contiver LOCALITY_TYPES, tentar 2ª com `allowPhoneCountryFallback=true`.
   - Se 2ª retornar resolução e país coerente com telefone, salvar cidade = entrada limpa e timezone retornado.

### Step 5: Modal Editar Localização (painel manual)
1. Client (AtendimentoClient.tsx:3040): `handleSaveEditLocationSelected` adicionar pré-resolução:
   ```ts
   const res = resolveStudentTimezone({city, state, phone: selectedLead?.phone ?? null, browserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone});
   const cityRes = resolveTimeZoneFromCityInput({city, state, phone: selectedLead?.phone ?? null, allowPhoneCountryFallback: true});
   const finalCity = cityRes?.city || city;
   const finalState = cityRes?.state || state;
   const finalTz = res || cityRes?.timeZone || undefined;
   const finalCountry = country inferido por inferCountry(finalState, finalCity, finalTz);
   const body = {city: finalCity, state: finalState, ...(finalTz && {timezone: finalTz}), ...(finalCountry && {country: finalCountry})};
   fetch PATCH body.
   ```

### Step 6: PATCH do lead (server fallback)
1. `leads/[leadId]/route.ts` (patch, 790-819): antes do UPDATE SQL Supabase, se `city` ou `state` estiverem no patch AND `timezone`/`country` não estiverem, calcular via `resolveTimeZoneFromCityInput(allowPhoneCountryFallback=true)`. Sempre salvar timezone válido (ainda que fallback por estado ou por fuso do país do telefone).

### Step 7: Testes
1. Casos em bot.test.ts conforme item 5 da seção "Arquivos e Módulos".
2. Garantir que testes existentes (Orlando FL, Primavera do Leste MT, estado FL FL, CA etc.) continuem passando NÃO são quebrados por amend (pois amend só apenda keywords, não remove).

### Step 8: Lint, typecheck, deploy
- `GetDiagnostics` nos 5 arquivos modificados.
- Deploy para preview na Vercel.

## Dependencies and Considerations

- **BASE_CITY_TIME_ZONE_RULES deve permanecer inalterada** (imutável) — a função amend deve sempre operar em deep copy. Isso garante que testes e qualquer código que dependa de referência antiga continue OK.
- **Strings duplicadas no amend**: usar `Array.from(new Set(...))` para remover keywords duplicadas (caso a localidade já exista na base). Não queremos arrays inflados.
- **Tamanho do mapa EXTENDED**: pode ficar bastante grande (milhares de nomes). Como é processado 1 vez em import e depois em memória só durante lookup O(n_rules * n_keywords_match), avaliar impacto em performance. Se ficar lento, uma melhoria futura é `Map<normalizedKeyword, Rule>`; mas por ora o projeto faz linear scan, então manter.
- **Substantivos estruturais**: incluir acentuados e não acentuados, plural/singular, lowercase somente após normalize.
- **Colônias da fronteira**: se uma colônia estiver em múltiplos condados (ex: El Paso), atribuir timezone americano America/Denver ou America/Chicago (conforme estado) — NÃO considerar fuso do México, a menos que o estado do usuário tenha sido reconhecido como mexicano (o mapa atual só suporta BR/US como países principais para timezone; se houver textos MX puros, cai em fallback país).
- **Risco: falso positivo** — nomes compostos que parecem "Vila" ou "Colonia" podem ser aceitos quando deveriam ser rejeitados. Mitigação: a validação por estado e país (estado match no stateKeywords) ainda é obrigatória como segunda condição.
- **Risco: "cidade" texto placeholder**: se o usuário enviar "Cidade X" onde X é errado, a remoção de prefixo estrutural "Cidade" pode mascarar. Mitigação: `LOCATION_PREPROCESS_PATTERNS` deve ser atualizada para **remover substantivos de tipo em contexto** (ex: "na vila de" → mantém só nome, mas "Vila Maria" → preserva a palavra Vila como parte do nome).
- **Compatibilidade WhatsApp ZApi**: nenhuma alteração na API do ZApi.
- **Compatibilidade DB**: nenhuma migração SQL necessária — os campos são text e já aceitam qualquer valor; só melhora qualidade do texto e do timezone associado.

## Validation

1. **Testes unitários bot.test.ts**:
   - Caso 1: "Vila Maria Alta, São Paulo" → cidade = "Vila Maria Alta", estado = "São Paulo", tz = America/Sao_Paulo, source = extended_locality_match.
   - Caso 2: "Edison Township NJ" → cidade = "Edison Township", estado = "New Jersey", tz = America/New_York, source = extended OU city_match.
   - Caso 3: "Socorro Colonia, El Paso TX" → cidade = "Socorro Colonia", estado = "Texas", tz = America/Chicago (Texas horário de verão? Ajustar. Texas central é America/Chicago; El Paso MT America/Denver — garantia: stateKeywords Texas central vs western refletem corretamente no BASE rules).
   - Caso 4: "The Villages FL" → tz = America/New_York (FL East).
   - Caso 5: "Plano Piloto DF" → tz = America/Sao_Paulo (DF).
2. **Runtime check**: executar `resolveTimeZoneFromCityInput` em loop nos primeiros 50 casos do mapa extendido para garantir source correto e timezone não nulo.
3. **Diagnostics TypeScript**: 0 erros.
4. **Deploy preview**: confirmar em preview URL que o painel manual agora persiste timezone ao salvar uma localidade extendida.

## Risks

- **Risco 1: Keywords map extendido excede memória ou tempo de lookup.** Mitigação: começamos com versões parciais por estado (top 200 distritos por estado). Se funcionar bem, em releases futuras adicionar mais entradas incrementalmente.
- **Risco 2: Match em localidade errada por mesmo nome em estados diferentes.** Mitigação: stateKeywords sempre obrigatório como 2ª condição no resolve (já existe hoje).
- **Risco 3: WhatsApp aceitar um texto aleatório que contenha "Vila" (ex.: "Vila você pensa o que").** Mitigação: substantivos estruturais só ativam as permissões extras se a normalização subsequente encontrar estado correspondente no stateKeywords; caso contrário, o fluxo continua a falhar no isReliable como antes.
- **Risco 4: Atualização de lead manual sobrescrever timezone já salvo anteriormente.** Mitigação: no PATCH server, só atualizar timezone se o novo valor for truthy; o valor antigo permanece como default se `city_resolver` retornar null.
