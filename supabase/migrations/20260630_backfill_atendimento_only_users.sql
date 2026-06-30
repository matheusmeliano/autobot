update public.profiles
set plano = 'vitalicio'
where access_scope = 'atendimento'
  and coalesce(plano, '') <> 'vitalicio';

update public.subscriptions
set plano = 'vitalicio',
    status = 'ativo',
    vencimento = null
where user_id in (
  select user_id
  from public.profiles
  where access_scope = 'atendimento'
);
