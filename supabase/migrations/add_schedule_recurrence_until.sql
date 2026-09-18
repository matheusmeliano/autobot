alter table if exists schedules
  add column if not exists recurrence_until date;
