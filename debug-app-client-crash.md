# Debug Session: app-client-crash

Status: OPEN

## Symptom
- Production shows: "Application error: a client-side exception has occurred while loading www.autobot.business"

## Scope
- Reproduce the runtime failure and capture evidence before changing business logic.

## Hypotheses
- H1: A recent `Atendimento` client component is throwing during render/hydration because a browser-only behavior is running with invalid state.
- H2: A recent UI change in `Atendimento` introduced a runtime exception from layout measurement or textarea resizing logic.
- H3: The error is not in `Atendimento`, but in another authenticated app route loaded by the shell, and the timing is only making it look related.
- H4: A stale production bundle or hydration mismatch is causing a client-only exception even though local static checks pass.
- H5: A callback/prop path in the latest `Atendimento` changes is undefined in one responsive branch and crashes when the page loads.

## Evidence Log
- Pending reproduction in production.
- Active hypotheses under test:
  - H1: `Atendimento` throws during render/hydration.
  - H2: Layout measurement or composer auto-resize throws on the client.
  - H3: Another authenticated route or shell dependency is crashing first.
  - H4: Production-only hydration/bundle mismatch is involved.
  - H5: A responsive callback/prop path is undefined in one branch.
- User clarified reproduction:
  - Route: authenticated `Atendimento`
  - Trigger: shrinking the layout/window with the mouse
  - Session state: logged in
- Static analysis found a resize-sensitive feedback path in `Atendimento`:
  - `AtendimentoLeadList` uses `ResizeObserver` to report height upward
  - `AtendimentoClient` feeds that height back into the conversation column
  - This coupling was active even while crossing out of desktop layout
- Fix applied:
  - height sync now reports only on desktop and resets on smaller layouts
  - repeated identical height updates are ignored
  - media-query listeners now use a defensive fallback for browsers without `addEventListener` on `MediaQueryList`
- User verification after first fix:
  - crash still reproduces while shrinking the authenticated `Atendimento` layout
- Second fix applied:
  - removed the JavaScript height synchronization between list and conversation
  - desktop alignment now relies on CSS layout only
  - removed the `ResizeObserver` feedback path from `AtendimentoLeadList`
- Validation:
  - `npm run build` passes locally
  - diagnostics are clean for the edited `Atendimento` files

## Next Step
- Ask the user to verify the responsive resize behavior in production and confirm whether the crash is gone.
