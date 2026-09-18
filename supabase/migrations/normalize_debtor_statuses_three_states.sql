update debtors
set status = case
  when lower(coalesce(status, '')) in ('pago') then 'pago'
  when lower(coalesce(status, '')) in ('atrasado') then 'atrasado'
  when lower(coalesce(status, '')) in ('pendente') then 'atrasado'
  when lower(coalesce(status, '')) in ('agendado') then 'agendado'
  when lower(coalesce(status, '')) in ('suspeita_de_pagamento', 'ativo') then 'agendado'
  when coalesce(status, '') = '' then 'agendado'
  else 'agendado'
end;
