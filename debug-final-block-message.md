# [OPEN] Debug Session: final-block-message

## Summary
- Symptom: after `Digitando...`, the public chat does not show the final WhatsApp validation block message on the 3rd invalid attempt.
- Expected: `Digitando...` and then only the final WhatsApp validation block message.

## Hypotheses
1. The final bot message is gated into the pending queue but never flushed before the blocked state settles.
2. A `replace` refresh after typing starts is discarding the queued final bot message.
3. The blocked-state transition is clearing or bypassing the pending bot queue before the final message becomes visible.
4. The API branch for the 3rd invalid attempt sometimes returns blocked state without the final outbound message payload.

## Evidence Plan
- Inspect the latest `post-fix` debug logs around the 3rd invalid attempt.
- Compare `bot_message_gating_evaluated`, `messages_applied`, and typing/flush events.
- Confirm whether the final message reaches the client and at which step it disappears.

## Status
- Current phase: evidence analysis.
