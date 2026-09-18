# Redesign Visual Minimalista (Modo Claro) em /app — Implementation Plan

## Repository Research
- Escopo estrito: **somente `/app/**` (dashboard, clientes, agendar, atendimento, mensagens, relatórios, admin, whatsapp, configurações, assinatura, agenda)**. Telas externas (`/login`, `/signup`, rotas públicas, `/admin` fora do app shell) **NÃO** são tocadas.
- Padrão visual desejado (referência do usuário):
  - fundo geral cinza muito claro;
  - sidebar lateral branca, limpa, organizada, item selecionado com fundo suave terracota/laranja;
  - área principal com bastante espaçamento;
  - cards brancos, cantos arredondados, bordas discretas, sombras quase nulas;
  - tipografia moderna/limpa, títulos negrito;
  - cor destaque terracota/laranja quente;
  - botões/inputs/tabelas minimalistas;
  - responsivo desktop/mobile.
- Arquitetura tema atual (NÃO alterar): tema é controlado por `AppShell.tsx` através de `data-theme="dark" | "light"` no `<html>` + CSS variables em `globals.css` bloco `.app-theme[data-theme="light"]` / `[data-theme="dark"]`. O backend/profile já suporta salvar `theme` mas o `saveTheme` em AppShell força `"dark"` hoje (hardcoded `const next: AppTheme = "dark"`); **NÃO** vamos alterar esse comportamento.
- Para aplicar o visual claro **sem tocar em persistência/regra**, a estratégia é: **sobre-escrever o bloco `.app-theme[data-theme="light"]` no globals.css para corresponder à referência**, e **forçar temporariamente o aplicativo a aplicar `data-theme="light"` apenas no escopo `/app` através de um flag inline em AppShell** (guard condicional que, quando a rota começa com `/app`, sobrepõe o theme aplicado no `<html>` para `light`, SEM modificar `saveTheme`, SEM modificar `profiles.theme`, SEM mudar o gating de auth). Essa abordagem é isolada e reversível: basta remover o guard em AppShell e o usuário volta ao tema anterior escuro default.
- Classes hardcoded (ex: `bg-black/60`, `text-white`, `bg-emerald-600`, `bg-rose-600`, cores de chart AreaChart indigo hardcoded) **serão convertidas gradualmente para as variáveis** `--app-*` correspondentes, **mantendo semântica** (status sucesso/warning/danger continuam verde/amarelo/vermelho, porém tons adequados para fundo branco). Nenhum handler, rota, API, formulário submit, estado, lógica de página ou Server Action é alterado.
- Sidebar atual: `AppShell.tsx` L516-553 (desktop sticky `w-72` container `rounded-2xl border bg-[var(--app-card)]`), nav items em `AppNav.tsx`. Vamos:
  - fundo sidebar: branco puro `#ffffff` via `--app-solid-surface` light;
  - item ativo: fundo terracota suave (ex: `rgba(217, 119, 6, 0.14)`) + texto terracota escuro (ex: `#9a3412`), borda esquerda discreta ou cantos arredondados (como referência "Início" com fundo salmão pálido);
  - ícones em itens de menu, fonte maior, espaçamento vertical mais amplo, avatar usuário e matrícula (no nosso caso email/perfil) no topo.
- Cards principais (`DashboardClient Card`, cards em AtendimentoSummaryCards, SchedulesClient, DebtorsClient): usar `--app-solid-surface (branco)`, `--app-border (cinza 12% transparência)`, sem sombra (`shadow-none` ou `shadow-sm` bem suave), cantos de `rounded-2xl` → manter `rounded-2xl`/`rounded-xl` existentes para não quebrar layouts.
- Fundo geral página: `--app-bg = #f5f5f4` (stone-100, cinza bem claro da referência).
- Cor destaque acento: **terracota quente** `#c2410c` (orange-700) / `#ea580c` (orange-600) / hover `#9a3412`. Usada em links, ícone terracota, item ativo, botão primário. Botão primário atual `--app-btn-primary-bg: #ffffff → fg: #000` vira `--app-btn-primary-bg: #ea580c → fg: #ffffff`.
- Tipografia: manter atual `-apple-system / Segoe UI` mas ajustar pesos (títulos `font-bold`, labels `font-semibold`).

## Files and Modules
**Alteração OBRIGATÓRIA (somente estes, ordem de dependência):**
1. `src/app/globals.css` — sobre-escrever bloco `.app-theme[data-theme="light"]` com tokens minimalistas claros e cor terracota; adicionar bloco `body, html` quando escopo app; ajustar inputs/autofill light, charts success/warning/danger light; **NÃO** alterar `dark`.
2. `src/components/app/AppShell.tsx` — (A) adicionar guard logo após o `useEffect` de aplicar `data-theme`: se `pathname.startsWith("/app")` → forçar `document.documentElement.setAttribute("data-theme", "light")` imediatamente (isso sobrepõe o tema salvo profile/dark); (B) ajustar sidebar container para sem sombra e branco; (C) drawer mobile usar branco e fundo backdrop claro; (D) ajustar container conteúdo área principal para fundo transparente (herda `--app-bg`) + padding maior; **NÃO** alterar handlers, rotas, navegação, logout, payment suspense, bot experimental, auth.
3. `src/components/app/AppNav.tsx` — estilizar items de menu (ícone + label, fundo ativo terracota claro + texto terracota, hover suave). Não alterar `href`, `restricted`, `plan` guards.
4. `src/components/app/DashboardClient.tsx` — (A) Card componente: trocar `bg-[var(--app-card-2)]` por `bg-[var(--app-solid-surface)]` (branco puro), ajustar espaçamento; (B) stat cards e activity cards usar novos tokens; (C) chart indigo hardcoded → cor terracota/orange; (D) badge status sucesso/atrasado usar tons claros legíveis em fundo branco. Manter cálculos, paginação, filtros, props.
5. `src/components/app/SectionShell.tsx` — (se existir e for wrapper comum) ajustar padding/bordas para novo visual; caso não use SectionShell de forma global, ajustes são por componente.

**Alterações OPCIONAIS (só se necessário e sem quebrar nada):**
- `src/components/app/schedules/SchedulesClient.tsx` — ajustar apenas cores/bordas via tokens; manter funcionalidades Disparar agora, mark as paid, paginação.
- `src/components/app/atendimento/AtendimentoSummaryCards.tsx` — ajustar tokens de card e abas; manter cálculos jump página/ref.
- `src/components/app/debtors/DebtorsClient.tsx`, `reports/ReportsClient.tsx`, `templates/TemplatesClient.tsx`, `whatsapp/WhatsAppClient.tsx` — só tokens CSS, nenhuma lógica.

**NÃO ALTERAR EM NENHUMA HIPÓTESE:**
- Qualquer Server Action, Route Handler (`/api/**`), backend Supabase queries, migrations, `actions.ts`.
- Lógica de auth/login/logout, profiles/theme (persistência).
- Navegação (rotas/links) — só aparência.
- Lógica de cobrança/Disparar agora (batch anterior) — só cores.

## Implementation Steps
1. **Atualizar tokens light em globals.css**: preencher `--app-bg #f5f5f4`, `--app-fg #0c0a09`, `--app-card #ffffff`, `--app-solid-surface #ffffff`, `--app-border rgba(12,10,9,0.08)`, `--app-btn-primary-bg #ea580c / fg #fff`, `--app-accent-color #ea580c`, success/warning/danger light tons readable, `--app-active rgba(234,88,12,0.14)` (terracota claro p/ item selecionado sidebar).
2. **Forçar aplicação light no escopo /app**: em `AppShell.tsx` adicionar `useEffect` com dependência `[pathname, theme]` — se `/app*` estiver ativo → `setAttribute("data-theme","light")` e aplicar `class app-theme` novamente; para outras rotas manter comportamento. Não alterar `saveTheme` (continua hardcoded dark).
3. **Ajustar containers layout AppShell**:
   - sidebar desktop: fundo `--app-solid-surface (branco)`, sem sombra (`shadow-none`), `rounded-2xl` mantido;
   - conteúdo: remover `bg-[var(--app-card)]` wrapper de área principal quando for `/app*` (assim o fundo cinza geral aparece), cards internos ficam brancos individualmente.
4. **Ajustar AppNav items sidebar**: aplicar `w-full rounded-xl px-3 py-2.5 gap-3 items-center text-[0.95rem] font-medium`, `ativo: bg-[var(--app-active)] text-[#9a3412] font-semibold`, `inativo: text-[var(--app-text-70)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text-85)]`. Ícones `h-5 w-5`.
5. **Ajustar DashboardClient**: tokens Card, chart area → terracota (#ea580c stroke + rgba(234,88,12,0.22) fill gradient), activity badges legíveis light, padding maior, título greeting bold.
6. **Validações**: checar telas `/app/dashboard`, `/app/clientes`, `/app/agendar`, `/app/atendimento` → nenhuma quebra de layout, texto legível, inputs com autofill correto, sidebar item ativo terracota, fundo cinza claro, cards brancos.

## Dependencies and Considerations
- Não há novas dependências npm; Tailwind já configurado padrão.
- Impacto zero em outras rotas fora `/app` porque o guard `pathname.startsWith("/app")` condiciona o tema light.
- Usuário com profile theme salvo não perde preferência persistida; o override é visual e temporário enquanto estiver em `/app` (sessão do navegador).
- Itens hardcoded `text-white`, `bg-black/55` backdrop mobile: trocar backdrop para `bg-stone-900/40` que funciona em light mode sem perder contraste.

## Validation
1. `npx tsc --noEmit` exit 0 — obrigatório antes de push.
2. Dev server local (`npm run dev`): abrir `/app/dashboard` →
   - fundo cinza claro não branco puro;
   - sidebar branca, item "Dashboard" ativo com fundo terracota claro;
   - cards brancos, bordas discretas, sem sombra forte;
   - botões primários laranja terracota com texto branco;
   - navegar /app/agendar → Disparar agora continua funcionando e estilizado;
   - mobile (devtools responsive): drawer mobile fecha ao navegar e tema continua claro.
3. Não exibir console errors/hidratação warning no Theme (porque o guard em AppShell roda no cliente após mount, usando `useEffect`; inicialização no primeiro paint depende do fallback `theme` em AppShell — manter o fallback mas ajustar rapidamente no effect).

## Risks
- **Risco: texto ilegível por contraste ruim em light mode (ex: `rgba(255,255,255,0.6)` text-white hardcoded em cards)** → mitigação: verificar componentes principais no passo 5 e trocar classes hardcoded por `--app-text-85/60` correspondentes; só ajustar se aparecer quebrado.
- **Risco: regressão auth por tocar no AppShell effect de data-theme** → mitigação: adicionar NOVO useEffect separado, não alterar nenhum existente; manter saveTheme e theme gating 100% intactos.
- **Risco: chart cores hardcoded permanecem indigo e não batem com terracota** → mitigação no step 5 trocar linearGradient e stroke/fill para `#ea580c`/rgba(234,88,12,0.22).
- **Risco: usuário pediu "SOMENTE EM /app" mas tema vaza para /login** → mitigação condição `pathname.startsWith("/app")` estrita no useEffect guard.
