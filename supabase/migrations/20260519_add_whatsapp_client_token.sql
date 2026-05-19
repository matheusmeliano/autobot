alter table if exists whatsapp_instances
  add column if not exists client_token text;

