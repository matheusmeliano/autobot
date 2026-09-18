-- Corrige pais registrado errado (Sudao -> Estados Unidos)
-- para o lead com CPF = 14014227376
-- Causa: bug de keyword "island" solta no regex do Sudao que batia
-- na substring "island" de "Rhode Island" (corrigido em commit b2f7045).

update public.atendimento_leads
set country = 'Estados Unidos',
    updated_at = now()
where cpf = '14014227376'
  and (country is null or country <> 'Estados Unidos');
