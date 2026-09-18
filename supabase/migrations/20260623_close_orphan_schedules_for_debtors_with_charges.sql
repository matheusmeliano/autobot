-- Para clientes que já possuem cobranças cadastradas, mantém apenas schedules ligados
-- explicitamente a uma charge. Schedules manuais legados sem charge_id devem ser encerrados.

with debtors_with_charges as (
  select distinct debtor_id
  from debtor_charges
),
orphan_schedules as (
  select s.id
  from schedules s
  join debtors_with_charges d
    on d.debtor_id = s.debtor_id
  where s.closed_at is null
    and s.charge_id is null
)
update schedules
set closed_at = now()
where id in (select id from orphan_schedules)
  and closed_at is null;
