update public.schedules
set payment_received_at = null
where recurrence in ('monthly', 'yearly')
  and status = 'agendado'
  and closed_at is null
  and payment_received_at is not null
  and (
    (charge_due_at is not null and payment_received_at < charge_due_at)
    or (data_envio is not null and payment_received_at < data_envio)
  );
