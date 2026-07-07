# [OPEN] Debug Session: chat-timing-flicker

## Summary
- Symptom: after the lead sends a message, the public chat visually flickers as if it reloaded, and the bot timing rules are not behaving fluently.
- Expected:
  - show `Digitando...` for 5 seconds before each new bot response;
  - block the composer for 5 seconds after each visible bot message;
  - always auto-scroll to the newest message without requiring manual scrolling.

## Hypotheses
1. Full message replacement after lead send is causing visible flicker in the chat tree.
2. A reset path clears the typing state before the bot queue finishes processing.
3. Composer cooldown starts at the wrong time or is skipped for some visible bot messages.
4. Auto-scroll races with polling/realtime updates and creates jumpy rendering.
5. The gating logic is being applied in the wrong lifecycle branch between session load, polling, and realtime updates.

## Evidence Plan
- Instrument message load/replace paths, queue state transitions, typing state transitions, cooldown activation, and autoscroll triggers.
- Reproduce one lead send followed by bot response sequence and compare event order.

## Status
- Current phase: instrumentation only.

## Evidence
- Confirmed: after the lead sends a message, the client starts typing correctly, but a subsequent `replace` load makes the queued bot message visible before the 5-second lead-in finishes.
- Confirmed by logs:
  - queued bot message starts typing at `trae-debug-log-chat-timing-flicker.ndjson:30`
  - a `replace` path immediately after shows `incomingCount = 6` and `nextCount = 6` while `typing = true` at lines `32-35`
  - this proves the hidden queued bot message leaks into the visible list during polling/replacement, causing the flicker and breaking the timing rule.
- Confirmed: cooldown starts only after queue flush, so if the message leaks early, the UI rules become visually inconsistent.

## Fix Applied
- Excluded already-queued bot messages from the visible message list during `replace` and other immediate apply paths.
- Kept queued bot messages hidden until `flushPendingBotMessages()` reveals them at the correct time.

## Current Phase
- Post-fix local validation completed; waiting for reproduction confirmation.

## Additional Evidence
- Confirmed: the first lead reply could re-trigger the non-silent `loadSession()` effect because the effect depended on the callback identity instead of the slug bootstrap state.
- Consequences:
  - `setLoading(true)` briefly showed `Iniciando atendimento...` again after the first lead message;
  - the non-silent path used direct `applyMessages(..., "replace")`, which could visually interrupt the queued bot sequence.

## Additional Fix Applied
- Restricted the initial non-silent session bootstrap to run only once per `linkSlug`.
- Hid `Iniciando atendimento...` whenever messages are already visible, even if a transient loading flag appears.
