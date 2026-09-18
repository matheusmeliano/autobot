alter table if exists profiles
  add column if not exists timezone text not null default 'America/Sao_Paulo';

