-- Adiciona coluna internal_notes para anotações internas dos atendentes (nunca exibidas ao aluno)
ALTER TABLE public.atendimento_leads
ADD COLUMN IF NOT EXISTS internal_notes TEXT NULL;
