begin;

alter table if exists whatsapp_instances
  add column if not exists phone text;

alter table if exists whatsapp_instances
  add column if not exists client_token text;

alter table if exists whatsapp_instances
  add column if not exists display_name text;

comment on column whatsapp_instances.phone is 'Número de telefone conectado à instância Z-API, no formato internacional BR (ex.: 5565999998888). Usado para comparação leniente de self-phone (anti-loop infinito) e blocklist dinâmica de números ocultos do painel, fallback para identificação quando display_name não é preenchido.';
comment on column whatsapp_instances.client_token is 'Token cliente da instância Z-API para autenticação adicional em endpoints como agendamentos e envios de mensagens transacionais.';
comment on column whatsapp_instances.display_name is 'Nome/apelido personalizado que o usuário atribui a este número conectado (ex: Suporte, Financeiro, Vendas, Professor Lucas). Usado como identificação principal na interface. Se vazio, fallback exibe o phone.';

commit;
