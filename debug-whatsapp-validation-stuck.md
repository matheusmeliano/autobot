# [OPEN] Debug Session: whatsapp-validation-stuck

## Summary
- Symptom: public atendimento keeps showing "Perfeito! Estou validando seu WhatsApp. Aguarde um instante." for invalid WhatsApp numbers.
- Requested behavior: all waits that are currently 1 minute must become 20 seconds; invalid number, no-WhatsApp number, and timeout must all count toward the same 3-attempt limit.

## Hypotheses
1. The timeout promotion from `phone_validation_pending` to failure is not running on every public chat refresh path.
2. The Z-API callback for non-WhatsApp numbers arrives, but the route does not classify it as a validation failure.
3. There are multiple timeout constants/paths, and at least one still uses 60 seconds.
4. The pending validation event cannot be matched back from callback identifiers, leaving the flow stuck.
5. The UI polling refreshes messages but misses the state change that should unblock the retry path.

## Evidence Plan
- Inspect all timeout constants and pending-validation transitions.
- Add minimal instrumentation only around timeout expiration and callback matching.
- Reproduce with invalid/non-WhatsApp number and compare pre-fix evidence.

## Status
- Current phase: instrumentation and evidence collection.

## Evidence
- Confirmed: `PHONE_VALIDATION_TIMEOUT_MS` was still `60_000` in `src/app/api/atendimento/public/messages/route.ts`.
- Confirmed: a recent `phone_validation_pending` event remained open for more than 7 minutes in `atendimento_history_events`, proving the timeout path was not being executed.
- Confirmed: recent `DeliveryCallback` events with `error = "Phone number does not exist"` are reaching `whatsapp_events`, so the provider can report invalid/non-WhatsApp numbers.
- Confirmed: polling in `PublicAtendimentoClient.tsx` only ran while `isInitialFlow` was true, so it stopped after the lead started replying and no longer triggered timeout promotion during WhatsApp validation.

## Fix Applied
- Reduced WhatsApp validation timeout from 60 seconds to 20 seconds.
- Kept timeout promotion on the server route and ensured the public client keeps polling while the last bot message is the WhatsApp validation pending message.

## Current Phase
- Fix implemented and locally verified with diagnostics and production build.

## Follow-up Evidence
- Confirmed: the client could remain stuck in `Digitando...` because the cleanup path depended on timestamp comparison (`created_at >= awaitingBotSince`).
- Confirmed: once a bot message is already visible, the typing indicator should be cleared regardless of timestamp skew.

## Follow-up Fix
- Added a client-side safeguard to reset the awaiting/typing state whenever the latest visible message is no longer from the lead or the conversation becomes blocked.
