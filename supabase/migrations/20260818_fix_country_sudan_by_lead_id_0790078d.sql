-- Corrige pais Sudao -> Estados Unidos para o lead Leo Lopez (Pawtucket/Rhode Island)
-- Identificado via busca: id = 0790078d-527a-47ae-beb7-bed3560da5cd
-- (O CPF informado 14014227376 nao estava gravado neste registro, por isso update por cpf nao pegou.)
-- Filtro de seguranca: id + cidade + estado + fuso + pais errado (evita sobrepor se registro mudou).

update public.atendimento_leads
set country = 'Estados Unidos',
    updated_at = now()
where id = '0790078d-527a-47ae-beb7-bed3560da5cd'::uuid
  and city = 'Pawtucket'
  and state = 'Rhode Island'
  and timezone = 'America/New_York'
  and country = 'Sudão';
