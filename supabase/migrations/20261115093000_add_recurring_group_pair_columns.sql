alter table public.atendimento_leads
  add column if not exists recurring_class_group_pair_id text;

alter table public.atendimento_leads
  add column if not exists recurring_class_group_status text;

create index if not exists atendimento_leads_recurring_class_group_pair_id_idx
  on public.atendimento_leads (recurring_class_group_pair_id);
