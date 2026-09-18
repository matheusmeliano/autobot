with target_debtors as (
  select id
  from debtors
  where nome in (
    'Pedro Rodrigues',
    'Eduardo Auto Mecânica',
    'Via Visuali Magazine',
    'Exalar Saúde e Bem Estar',
    'Loivo (Marketing Digital)',
    'Loivo (Landing Page + Sistema)',
    'Pastelaria Chinesa Massa',
    'Jorge Hair'
  )
),
target_schedules as (
  select id
  from schedules
  where debtor_id in (select id from target_debtors)
    and closed_at is null
)
update schedules
set status = 'pago',
    payment_received_at = now()
where id in (select id from target_schedules)
  and payment_received_at is null;
