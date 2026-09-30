alter table if exists public.atendimento_messages
  add column if not exists idempotency_key text;

comment on column public.atendimento_messages.idempotency_key is
  'Fingerprint de idempotencia para bloquear duplicidade de envio em janela curta (45s). Formato: sha256(cid::role::txt::media::fileName) truncado em 32 chars.';

create index if not exists atendimento_messages_idempotency_key_idx
  on public.atendimento_messages (idempotency_key);
