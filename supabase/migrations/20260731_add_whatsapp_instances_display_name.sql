begin;

alter table if exists whatsapp_instances
  add column if not exists display_name text;

comment on column whatsapp_instances.display_name is 'Nome/apelido personalizado que o usuario atribui a este numero conectado (ex: Suporte, Financeiro, Vendas, Professor Lucas). Usado como identificacao principal na interface, substituindo apenas a exibicao do numero. Campo opcional. Se vazio, o fallback de exibicao usa whatsapp_instances.phone.';

commit;
