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
  "state",
  "city",
] as const;

export const NUMERIC_ONLY_FIELDS = [
  "phone",
] as const;

export const CAPTURED_FIELD_PROMPTS: Record<(typeof CAPTURED_FIELD_ORDER)[number], string> = {
  full_name: "Perfeito. Para começarmos, me diga seu nome completo.",
  phone:
    "Perfeito! Para começarmos, informe o número do seu WhatsApp.\n\nBrasil: +55 (65) 99999-9999\nEstados Unidos: +1 (407) 555-1234\n\nImportante: inclua o código do país no início do número (+55 para Brasil ou +1 para Estados Unidos).",
  state: "Perfeito! Agora, informe o estado onde você mora.",
  city: "E a cidade?",
};

export const ATENDIMENTO_PROFESSOR_TIME_ZONE = "America/Cuiaba";
export const WHATSAPP_REGISTERED_SUCCESS_MESSAGE = "WhatsApp registrado com sucesso.";
export const EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE =
  "Maravilha! Agora é só escolher o melhor dia e horário para a sua aula experimental. Qual data você prefere?";
export const LOCATION_STATE_INVALID_MESSAGE =
  "Não foi possível identificar o estado informado. Informe novamente apenas o estado onde você mora.";
export const LOCATION_CITY_INVALID_MESSAGE =
  "Não foi possível identificar a cidade informada com base no estado enviado. Informe novamente apenas a cidade onde você mora.";
export const ATENDIMENTO_BLOCKED_FINAL_MESSAGE =
  "Não foi possível validar seu número de WhatsApp após 3 tentativas. Este cadastro foi bloqueado. Para tentar novamente, entre em contato com nosso suporte para desbloquear o e-mail utilizado ou realize um novo cadastro com outro e-mail.\n\nFale com nossa equipe pelo link abaixo:\n\nhttps://wa.me/5565996933336";
export const LOCATION_STATE_BLOCKED_FINAL_MESSAGE =
  "Não foi possível validar seu estado após 3 tentativas. Este cadastro foi bloqueado. Para tentar novamente, entre em contato com nosso suporte para desbloquear o e-mail utilizado ou realize um novo cadastro com outro e-mail.\n\nFale com nossa equipe pelo link abaixo:\n\nhttps://wa.me/5565996933336";
export const LOCATION_CITY_BLOCKED_FINAL_MESSAGE =
  "Não foi possível validar sua cidade após 3 tentativas. Este cadastro foi bloqueado. Para tentar novamente, entre em contato com nosso suporte para desbloquear o e-mail utilizado ou realize um novo cadastro com outro e-mail.\n\nFale com nossa equipe pelo link abaixo:\n\nhttps://wa.me/5565996933336";

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
