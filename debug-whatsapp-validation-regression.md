# [OPEN] Debug Session: whatsapp-validation-regression

## Summary
- Symptom: after the recent validation changes, the public atendimento no longer validates and sends to a WhatsApp number that previously worked.
- Expected: when a valid WhatsApp number is informed and the instance can send, the flow must create the validation attempt, receive provider confirmation, and continue to the next onboarding step.

## Hypotheses
1. The recent `connected`-only gate in `server.ts` is rejecting the active instance even though it is still operational for sends.
2. The webhook is persisting an outdated `disconnected` status and the send path is now blocked by stale state rather than real runtime connectivity.
3. The public route now converts a recoverable send state into the technical error message before the provider has a chance to confirm delivery.
4. The provider is still accepting the send request, but the callback identifiers no longer match the pending validation event, so the flow never exits pending.
5. The current production attempt never reaches the provider at all because the backend exits early on the instance-status gate.

## Evidence Plan
- Inspect the current send-path gate and the latest webhook status-sync logic.
- Check the most recent production validation attempt in Supabase to see whether a pending event and outbound message IDs were created.
- Confirm whether the provider accepted the send, whether callbacks arrived, and whether the instance gate blocked the attempt before send.

## Evidence
- Confirmed in Supabase: the active atendimento profile is `atendimento.usa.music@gmail.com` with `user_id = ab061ca5-4fac-4175-9321-e8ea14ebcb13`.
- Confirmed in Supabase: the active atendimento WhatsApp instance `3F4637B99226817E084AFAED5EA750A2` is persisted with `status = configured`, not `connected`.
- Confirmed in code: `getAtendimentoWhatsAppConfig()` was rejecting any instance whose status was not strictly `connected`, returning `null` before any provider send attempt.
- Confirmed in runtime state: the latest public conversation received the user phone `5565996933336`, but no outbound validation message or `phone_validation_pending` continuation followed after that input.
- Supporting context: recent `whatsapp_events` for the same instance include `DeliveryCallback`, `ReceivedCallback`, `MessageStatusCallback`, and a later `DisconnectedCallback`, which proves the send path cannot safely rely on a strict persisted `connected` gate alone.

## Fix
- Added debug instrumentation in `src/lib/atendimento/server.ts` to log the loaded WhatsApp config, persisted status, and rejection reason when the config gate blocks the send path.
- Applied the minimal regression fix in `src/lib/atendimento/server.ts`: the send path now accepts the active instance when its persisted status is `connected` or `configured`.
- Validation: `GetDiagnostics` returned no issues for the edited file and `npm.cmd run build` completed successfully.
- New evidence from the latest production attempt: a `phone_validation_pending` for `+5565996348707` was created with `external_message_id = 69BAC71BF8C456184720` and `zaap_id = 019F38283F8C7CADABE040469EEF9D1E`, then converted to `phone_validation_timeout` about 21 seconds later.
- Confirmed in Supabase: there were no `whatsapp_events` recorded for the active instance after `2026-07-06T15:59:00Z`, so the latest timeout happened without any callback arriving during the 20-second window.
- Applied the minimal timing adjustment in `src/app/api/atendimento/public/messages/route.ts`: `PHONE_VALIDATION_TIMEOUT_MS` now waits 60 seconds instead of 20 seconds before classifying the attempt as technical timeout.

## Status
- Current phase: timeout window extended based on runtime evidence and ready for production verification.
