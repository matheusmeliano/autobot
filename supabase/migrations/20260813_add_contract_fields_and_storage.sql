-- Formalizacao do contrato de prestacao de servicos educacionais

alter table if exists public.atendimento_leads
  add column if not exists legal_responsible_name text;
alter table if exists public.atendimento_leads
  add column if not exists legal_responsible_cpf text;
alter table if exists public.atendimento_leads
  add column if not exists contract_status text not null default 'nao_iniciado';
alter table if exists public.atendimento_leads
  add column if not exists contract_signed_at timestamptz;
alter table if exists public.atendimento_leads
  add column if not exists contract_pdf_url text;
alter table if exists public.atendimento_leads
  add column if not exists contract_html_snapshot text;

comment on column public.atendimento_leads.contract_status is 'nao_iniciado | coletando_dados | aguardando_aceite | assinado | rejeitado';
