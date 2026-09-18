alter table if exists schedules
  drop constraint if exists schedules_recurrence_check;

alter table if exists schedules
  add constraint schedules_recurrence_check
  check (recurrence in ('none', 'monthly', 'yearly'));
