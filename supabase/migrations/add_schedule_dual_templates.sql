alter table public.schedules
  add column if not exists template_pending_id uuid references public.message_templates(id) on delete set null,
  add column if not exists template_overdue_id uuid references public.message_templates(id) on delete set null;

update public.schedules
set
  template_pending_id = coalesce(template_pending_id, template_id),
  template_overdue_id = coalesce(template_overdue_id, template_id)
where template_id is not null;
