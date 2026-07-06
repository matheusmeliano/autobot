export const ATENDIMENTO_EMAIL = "atendimento.usa.music@gmail.com";
export const ATENDIMENTO_PUBLIC_LINK_SLUG = "lucas-brum-online-music-usa";

export const ATENDIMENTO_STAGE_ORDER = [
  "novo_lead",
  "em_atendimento",
  "metodologia_apresentada",
  "aula_experimental_convidada",
  "aula_experimental_agendada",
  "pre_cadastro_concluido",
  "matricula_pendente",
  "matriculado",
  "encerrado",
] as const;

export const ATENDIMENTO_STATUS_ORDER = [
  "novo_lead",
  "em_atendimento",
  "matricula_pendente",
  "matriculado",
  "encerrado",
] as const;

export const CAPTURED_FIELD_ORDER = [
  "full_name",
  "phone",
] as const;

export const CAPTURED_FIELD_PROMPTS: Record<(typeof CAPTURED_FIELD_ORDER)[number], string> = {
  full_name: "Perfeito. Para começarmos, me diga seu nome completo.",
  phone:
    "Perfeito! Para começarmos, informe o número do seu WhatsApp.\n\nBrasil: +55 (65) 99999-9999\nEstados Unidos: +1 (407) 555-1234\n\nImportante: inclua o código do país no início do número (+55 para Brasil ou +1 para Estados Unidos).",
};

export const STAGE_LABELS: Record<string, string> = {
  novo_lead: "Novo Lead",
  em_atendimento: "Em Atendimento",
  metodologia_apresentada: "Metodologia Apresentada",
  aula_experimental_convidada: "Aula Experimental Convidada",
  aula_experimental_agendada: "Aula Experimental Agendada",
  pre_cadastro_concluido: "Pré-Cadastro Concluído",
  matricula_pendente: "Matrícula Pendente",
  matriculado: "Matriculado",
  encerrado: "Encerrado",
};

export const STATUS_LABELS: Record<string, string> = {
  novo_lead: "Novo Lead",
  em_atendimento: "Em Atendimento",
  matricula_pendente: "Matrícula Pendente",
  matriculado: "Matriculado",
  encerrado: "Encerrado",
};
