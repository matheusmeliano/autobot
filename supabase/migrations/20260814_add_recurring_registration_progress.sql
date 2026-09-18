alter table public.atendimento_leads
  add column if not exists recurring_registration_step int2 not null default 0;

alter table public.atendimento_leads
  add column if not exists recurring_registration_password text;

alter table public.atendimento_leads
  add column if not exists recurring_class_weekday text;

alter table public.atendimento_leads
  add column if not exists recurring_class_weekday_label text;

alter table public.atendimento_leads
  add column if not exists recurring_class_professor_time text;

alter table public.atendimento_leads
  add column if not exists recurring_class_lead_time text;

alter table public.atendimento_leads
  add column if not exists legal_responsible_name text;

alter table public.atendimento_leads
  add column if not exists legal_responsible_cpf text;

create index if not exists atendimento_leads_recurring_reg_step_idx
  on public.atendimento_leads (recurring_registration_step);
