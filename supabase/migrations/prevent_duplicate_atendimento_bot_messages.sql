with ranked as (
  select
    id,
    row_number() over (
      partition by conversation_id, content_text
      order by created_at asc, id asc
    ) as rn
  from public.atendimento_messages
  where sender_role = 'bot' and content_text is not null
)
delete from public.atendimento_messages as m
using ranked as r
where m.id = r.id and r.rn > 1;

create unique index if not exists atendimento_messages_unique_bot_content_per_conversation
on public.atendimento_messages (conversation_id, content_text)
where sender_role = 'bot' and content_text is not null;

