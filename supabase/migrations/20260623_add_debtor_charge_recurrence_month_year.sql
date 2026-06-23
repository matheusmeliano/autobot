alter table debtor_charges
  add column if not exists recurrence_month int,
  add column if not exists recurrence_year int;

update debtor_charges
set
  recurrence_month = case
    when recurrence_month between 1 and 12 then recurrence_month
    when recurrence_unit = 'yearly' then extract(month from current_date)::int
    else extract(month from (current_date + interval '1 month'))::int
  end,
  recurrence_year = case
    when recurrence_year between 2000 and 9999 then recurrence_year
    when recurrence_unit = 'yearly' then extract(year from (current_date + interval '1 year'))::int
    else extract(year from (current_date + interval '1 month'))::int
  end
where recurrence_month is null
   or recurrence_year is null;

alter table debtor_charges
  drop constraint if exists debtor_charges_recurrence_month_check;

alter table debtor_charges
  add constraint debtor_charges_recurrence_month_check
  check (recurrence_month >= 1 and recurrence_month <= 12);

alter table debtor_charges
  drop constraint if exists debtor_charges_recurrence_year_check;

alter table debtor_charges
  add constraint debtor_charges_recurrence_year_check
  check (recurrence_year >= 2000 and recurrence_year <= 9999);
