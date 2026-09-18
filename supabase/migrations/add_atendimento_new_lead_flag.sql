alter table public.atendimento_leads
  add column if not exists is_new_for_attendant boolean not null default false;

update public.atendimento_leads
set is_new_for_attendant = false
where is_new_for_attendant is distinct from false;
