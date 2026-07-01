drop policy if exists "Authenticated atendimento lead uploads files" on storage.objects;
create policy "Authenticated atendimento lead uploads files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'atendimento-files'
  and split_part(name, '/', 1) = 'conversations'
  and split_part(name, '/', 3) = 'lead'
  and exists (
    select 1
    from public.atendimento_conversations c
    join public.atendimento_leads l on l.id = c.lead_id
    where c.id::text = split_part(name, '/', 2)
      and l.auth_user_id = auth.uid()
  )
);

drop policy if exists "Authenticated atendimento lead reads files" on storage.objects;
create policy "Authenticated atendimento lead reads files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'atendimento-files'
  and split_part(name, '/', 1) = 'conversations'
  and exists (
    select 1
    from public.atendimento_conversations c
    join public.atendimento_leads l on l.id = c.lead_id
    where c.id::text = split_part(name, '/', 2)
      and l.auth_user_id = auth.uid()
  )
);

drop policy if exists "Atendimento attendant uploads files" on storage.objects;
create policy "Atendimento attendant uploads files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'atendimento-files'
  and split_part(name, '/', 1) = 'conversations'
  and split_part(name, '/', 3) = 'attendant'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'atendimento.usa.music@gmail.com'
);

drop policy if exists "Atendimento attendant reads files" on storage.objects;
create policy "Atendimento attendant reads files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'atendimento-files'
  and split_part(name, '/', 1) = 'conversations'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'atendimento.usa.music@gmail.com'
);
