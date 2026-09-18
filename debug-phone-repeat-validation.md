# [OPEN] Debug Session: phone-repeat-validation

## Summary
- Symptom: after the public atendimento asks for the WhatsApp number, the numeric validation error is shown once but is not repeated on subsequent invalid replies.
- Expected: every invalid reply for the numeric-only phone step must trigger the same validation message again until the user sends only numbers.

## Hypotheses
1. The latest backend fix was pushed to GitHub but is still not deployed in production, so the user is testing an older build.
2. The backend inserts the repeated bot validation message correctly, but the public client queue/dedupe logic drops or hides the second identical bot message.
3. The public message route stops inferring `phone` as the expected field after the first invalid reply, so later invalid replies bypass the numeric validation branch.
4. The repeated bot message is created, but a subsequent polling or realtime refresh replaces the visible message list and removes it from the UI.

## Evidence
- Production was missing commit `c6a94f5` at first; after manual publish, `Production/main` became `Ready` with that commit.
- Remote `atendimento_messages` for conversation `e38483af-d31b-40c7-a913-91adac99280f` shows:
  - first invalid text-only reply produced bot message `Essa resposta não me parece válida. Responda somente com números.`
  - second invalid text-only reply produced no bot message
  - later mixed reply produced bot message `Por favor, responda somente com números.`
- Remote `atendimento_history_events` for the same conversation shows `numeric_field_validation_failed` for all three invalid replies, including the second text-only reply that produced no bot message.
- Migration [prevent_duplicate_atendimento_bot_messages.sql](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/supabase/migrations/prevent_duplicate_atendimento_bot_messages.sql) creates a unique index on `(conversation_id, content_text)` for bot messages.
- The public route in [route.ts](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/app/api/atendimento/public/messages/route.ts#L607-L628) swallows `23505`, so the duplicate insert failure becomes a silent no-op instead of a visible bot reply.

## Conclusion
- Root cause confirmed: repeated bot validation messages are being blocked by the database unique index on repeated bot content per conversation.
- The route then treats the duplicate-key failure as acceptable and returns success without a new outbound message, which is why the user sees no repeated validation bubble.
