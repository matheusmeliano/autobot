alter table debtor_charges
  add column if not exists recurrence_unit text not null default 'monthly';

alter table debtor_charges
  drop constraint if exists debtor_charges_recurrence_unit_check;

alter table debtor_charges
  add constraint debtor_charges_recurrence_unit_check
  check (recurrence_unit in ('monthly', 'yearly'));

update debtor_charges
set recurrence_unit = 'monthly'
where recurrence_unit is null or recurrence_unit not in ('monthly', 'yearly');
