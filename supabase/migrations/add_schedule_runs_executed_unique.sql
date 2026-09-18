with duplicated_executed_runs as (
  select id
  from (
    select
      id,
      row_number() over (
        partition by schedule_id, scheduled_for
        order by created_at asc, id asc
      ) as row_num
    from schedule_runs
    where status = 'executado'
  ) ranked
  where ranked.row_num > 1
)
delete from schedule_runs
where id in (select id from duplicated_executed_runs);

create unique index if not exists uniq_schedule_runs_executed_once
on schedule_runs (schedule_id, scheduled_for)
where status = 'executado';
