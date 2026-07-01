begin;

alter table public.atendimento_leads replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.atendimento_leads;
exception
  when duplicate_object then null;
end $$;

commit;

