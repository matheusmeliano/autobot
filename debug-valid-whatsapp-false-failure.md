# [OPEN] Debug Session: valid-whatsapp-false-failure

## Summary
- Symptom: a valid WhatsApp number is informed in the public atendimento flow, but the test message is not delivered to WhatsApp and the chatbot enters the invalid/failure flow.
- Expected: only two paths are allowed after phone input: successful validation followed by the next onboarding step, or real validation failure when send/validation actually fails.

## Hypotheses
1. The Z-API send request is failing due to transport/configuration and the backend is collapsing that error into the same path as invalid WhatsApp.
2. The Z-API send request is accepted, but the acceptance payload is not recognized as valid by `wasWhatsAppSendAccepted()`.
3. The pending validation event is saved, but webhook callbacks are not correlated back to the pending event because identifiers differ.
4. Phone normalization differs between send-time and callback-time, breaking validation confirmation for otherwise valid numbers.
5. The client renders an error state before the backend has definitive evidence that the send/validation failed.

## Evidence Plan
- Instrument the public phone POST route around send attempt, accepted payload parsing, pending-event persistence, and returned response.
- Instrument the Z-API webhook route around callback identifier extraction, pending-event correlation, and final success/failure classification.
- Reproduce with a known valid WhatsApp number and compare pre-fix logs.

## Status
- Current phase: instrumentation.

## Evidence
- Confirmed: the valid number `5565996933336` did not produce `phone_validated`; it produced `phone_validation_failed` with `final_status = TIMEOUT`.
- Confirmed: the saved validation attempt included `external_message_id = 73594F0EDA1496B9244B` and `zaap_id = 019F374E1D5A78ECB81349653F75B378`, proving the send attempt was created.
- Confirmed: there was no explicit provider error like `Phone number does not exist` for that attempt.
- Confirmed: the flow was collapsing technical timeout into the same invalid-number branch shown to the user.

## Fix Applied
- Timeout expiration in the public validation route now becomes `phone_validation_timeout` instead of `phone_validation_failed`.
- Technical timeout no longer consumes invalid attempts, no longer blocks the conversation, and no longer shows the invalid-number retry message.
- Delivery callbacks with explicit invalid-number evidence still use the real invalid-number flow.
- Delivery callbacks with technical/provider delivery errors now use the same technical-timeout branch instead of the invalid-number branch.

## Current Phase
- Fix implemented and locally validated with diagnostics and production build.
