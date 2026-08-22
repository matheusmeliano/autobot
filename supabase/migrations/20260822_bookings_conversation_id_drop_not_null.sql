do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'atendimento_experimental_class_bookings'
      and column_name = 'conversation_id'
      and is_nullable = 'NO'
  ) then
    alter table public.atendimento_experimental_class_bookings
      alter column conversation_id drop not null;
  end if;

  if exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_name = 'atendimento_experimental_class_bookings'
      and kcu.column_name = 'conversation_id'
  ) then
    alter table public.atendimento_experimental_class_bookings
      drop constraint if exists atendimento_experimental_class_bookings_conversation_id_fkey;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'atendimento_experimental_class_bookings'
      and column_name = 'conversation_id'
  ) then
    alter table public.atendimento_experimental_class_bookings
      add constraint atendimento_experimental_class_bookings_conversation_id_fkey
      foreign key (conversation_id) references public.atendimento_conversations(id)
      on delete set null;
  end if;
end $$;
