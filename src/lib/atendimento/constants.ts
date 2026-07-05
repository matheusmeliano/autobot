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
  "cpf",
  "email",
  "city",
  "state",
  "country",
  "timezone",
  "best_contact_time",
] as const;

export const CAPTURED_FIELD_PROMPTS: Record<(typeof CAPTURED_FIELD_ORDER)[number], string> = {
  full_name: "Perfeito. Para começarmos, me diga seu nome completo.",
  phone: "Perfeito! Para começar, informe seu número de WhatsApp.",
  cpf: "Pode me informar seu CPF para adiantarmos o pré-cadastro?",
  email: "Qual é o seu melhor e-mail?",
  city: "Em qual cidade você mora?",
  state: "Qual é o seu estado?",
  country: "Em qual país você está hoje?",
  timezone: "Qual é o seu fuso horário? Ex.: America/New_York ou GMT-4.",
  best_contact_time: "Qual é o melhor horário para falarmos com você?",
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
