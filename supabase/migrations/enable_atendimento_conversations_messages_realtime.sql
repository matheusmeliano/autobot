begin;

alter table public.atendimento_conversations replica identity full;
alter table public.atendimento_messages replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.atendimento_conversations;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.atendimento_messages;
exception
  when duplicate_object then null;
end $$;

commit;

