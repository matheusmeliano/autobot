alter table if exists schedules add column if not exists recurrence text;
alter table if exists schedules add column if not exists schedule_timezone text;
alter table if exists schedules add column if not exists recurrence_day smallint;
alter table if exists schedules add column if not exists recurrence_time text;

update schedules set recurrence = 'none' where recurrence is null;
alter table if exists schedules alter column recurrence set default 'none';

alter table if exists schedules
  drop constraint if exists schedules_recurrence_check;
alter table if exists schedules
  add constraint schedules_recurrence_check check (recurrence in ('none', 'monthly'));

create table if not exists schedule_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  schedule_id uuid not null references schedules(id) on delete cascade,
  scheduled_for timestamptz not null,
  executed_at timestamptz not null default now(),
  status text not null,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_schedule_runs_user_id on schedule_runs(user_id);
create index if not exists idx_schedule_runs_schedule_id on schedule_runs(schedule_id);
create index if not exists idx_schedule_runs_scheduled_for on schedule_runs(user_id, scheduled_for desc);

alter table if exists schedule_runs enable row level security;

drop policy if exists "schedule_runs_select_own" on schedule_runs;
create policy "schedule_runs_select_own"
on schedule_runs for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "schedule_runs_insert_own" on schedule_runs;
create policy "schedule_runs_insert_own"
on schedule_runs for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "schedule_runs_update_own" on schedule_runs;
create policy "schedule_runs_update_own"
on schedule_runs for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "schedule_runs_delete_own" on schedule_runs;
create policy "schedule_runs_delete_own"
on schedule_runs for delete
to authenticated
using (user_id = auth.uid());

