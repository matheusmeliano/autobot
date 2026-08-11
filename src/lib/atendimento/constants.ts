export const ATENDIMENTO_EMAIL = "atendimento.usa.music@gmail.com";
export const ATENDIMENTO_PUBLIC_LINK_SLUG = "lucas-brum-online-music-usa";

export const ZAPI_INTERNAL_PHONE_BLOCKLIST_SUFFIX_10: readonly string[] = [
  "6599495594",
  "6581175345",
];

export const OWNER_PERSONAL_PRIVATE_PHONE_SUFFIXES_10: readonly string[] = [
  "6596933336",
];

export const BOT_DEDICATED_EXCLUSIVE_PHONE_SUFFIXES_10: readonly string[] = [
  "6599495594",
  "6581175345",
];

function matchBrazilianPhoneSuffix(digitsRaw: string | null | undefined, suffixesList: readonly string[]): boolean {
  const d = String(digitsRaw ?? "").replace(/\D/g, "");
  const key = d.length >= 10 ? d.slice(-10) : d;
  if (!key) return false;
  for (const suffix of suffixesList) {
    if (key === suffix || key.endsWith(suffix) || suffix.endsWith(key)) {
      return true;
    }
  }
  return false;
}

export function isZapiInternalBlocklistedPhone(digitsRaw: string | null | undefined): boolean {
  return matchBrazilianPhoneSuffix(digitsRaw, ZAPI_INTERNAL_PHONE_BLOCKLIST_SUFFIX_10);
}

export function isOwnerPersonalPrivatePhone(digitsRaw: string | null | undefined): boolean {
  return matchBrazilianPhoneSuffix(digitsRaw, OWNER_PERSONAL_PRIVATE_PHONE_SUFFIXES_10);
}

export function isDedicatedExclusiveBotPhone(digitsRaw: string | null | undefined): boolean {
  return matchBrazilianPhoneSuffix(digitsRaw, BOT_DEDICATED_EXCLUSIVE_PHONE_SUFFIXES_10);
}

export const ATENDIMENTO_STAGE_ORDER = [
  "novo_lead",
  "em_atendimento",
  "metodologia_apresentada",
  "aula_experimental_convidada",
  "aula_experimental_agendada",
  "pre_cadastro_concluido",
  "matricula_pendente",
  "matriculado",
  "matricula_pendente_recusada",
  "cadastro_recorrente_pendente_plataforma",
  "aluno_recorrente_cadastrado",
  "encerrado",
] as const;

export const ATENDIMENTO_STATUS_ORDER = [
  "novo_lead",
  "em_atendimento",
  "matricula_pendente",
  "matriculado",
  "matricula_pendente_recusada",
  "cadastro_recorrente_pendente_plataforma",
  "aluno",
  "encerrado",
] as const;

export const CAPTURED_FIELD_ORDER = [
  "full_name",
  "phone",
  "state",
  "city",
] as const;

export const ACTIVE_CAPTURED_FIELD_ORDER = [
  "full_name",
  "phone",
  "state",
  "city",
] as const;

export const NUMERIC_ONLY_FIELDS = [
  "phone",
  "cpf",
] as const;

export const CAPTURED_FIELD_PROMPTS: Record<(typeof CAPTURED_FIELD_ORDER)[number], string> = {
  full_name: "Qual é o seu nome?",
  phone:
    "Perfeito! Para começarmos, informe o número do seu WhatsApp.\n\nBrasil: +55 (65) 99999-9999\nEstados Unidos: +1 (407) 555-1234\n\nImportante: inclua o código do país no início do número (+55 para Brasil ou +1 para Estados Unidos).",
  state: "Em qual estado você mora?",
  city: "E a cidade?",
};

export function buildStatePrompt(name: string | null | undefined): string {
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "";
  const prefix = safeFirst ? `Beleza, ${safeFirst}! ` : "";
  return `${prefix}Em qual estado você mora?`;
}

export const POST_BOOKING_CPF_STAGE_ENABLED = false;
export const POST_BOOKING_CPF_PROMPT =
  "Para finalizarmos e enviarmos o convite da aula experimental, qual é o seu CPF?\n\nVocê pode informar com ou sem pontos e traço.\nExemplo: 123.456.789-09";
export const POST_BOOKING_CPF_SUCCESS_MESSAGE =
  "Obrigado! CPF recebido e cadastro concluído com sucesso. Em breve entraremos em contato com o link e os detalhes da sua aula experimental.";

export const ATENDIMENTO_PROFESSOR_TIME_ZONE = "America/Cuiaba";
export const WHATSAPP_REGISTERED_SUCCESS_MESSAGE = "WhatsApp registrado com sucesso.";
export const EXPERIMENTAL_CLASS_DATE_INTRO_MESSAGE =
  "Agora é só escolher o melhor dia e horário para sua aula experimental.";
export const EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE = "Para começarmos, qual dia você prefere?";
export function buildExperimentalClassDatePromptMessages(name?: string | null) {
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "";
  if (safeFirst) {
    return [
      `${safeFirst}, agora é só escolher o melhor dia e horário para sua aula experimental.`,
    ];
  }
  return [
    `Agora é só escolher o melhor dia e horário para sua aula experimental.`,
  ];
}
export const LOCATION_STATE_INVALID_MESSAGE =
  "Não foi possível identificar o estado informado. Informe novamente apenas o estado onde você mora.";
export const LOCATION_CITY_INVALID_MESSAGE =
  "Não foi possível identificar a cidade informada com base no estado enviado. Informe novamente apenas a cidade onde você mora.";
export const EXPERIMENTAL_CLASS_DATE_INVALID_MESSAGE =
  "Não foi possível validar o dia informado. Responda novamente apenas com o dia desejado.";
export const EXPERIMENTAL_CLASS_TIME_INVALID_MESSAGE =
  "Não foi possível validar o horário informado. Responda novamente apenas com o horário desejado.";
export const ATENDIMENTO_BLOCKED_FINAL_MESSAGE =
  "Não foi possível validar seu número de WhatsApp após 3 tentativas. Este cadastro foi bloqueado. Para tentar novamente, entre em contato com nosso suporte para desbloquear o e-mail utilizado ou realize um novo cadastro com outro e-mail.\n\nFale com nossa equipe pelo link abaixo:\n\nhttps://wa.me/5565996933336";
export const LOCATION_STATE_BLOCKED_FINAL_MESSAGE =
  "Não foi possível validar seu estado após 3 tentativas. Este cadastro foi bloqueado. Para tentar novamente, entre em contato com nosso suporte para desbloquear o e-mail utilizado ou realize um novo cadastro com outro e-mail.\n\nFale com nossa equipe pelo link abaixo:\n\nhttps://wa.me/5565996933336";
export const LOCATION_CITY_BLOCKED_FINAL_MESSAGE =
  "Não foi possível validar sua cidade após 3 tentativas. Este cadastro foi bloqueado. Para tentar novamente, entre em contato com nosso suporte para desbloquear o e-mail utilizado ou realize um novo cadastro com outro e-mail.\n\nFale com nossa equipe pelo link abaixo:\n\nhttps://wa.me/5565996933336";
export const EXPERIMENTAL_CLASS_DATE_BLOCKED_FINAL_MESSAGE =
  "Não foi possível validar o dia informado após 3 tentativas. Este cadastro foi bloqueado. Para tentar novamente, entre em contato com nosso suporte para desbloquear o e-mail utilizado ou realize um novo cadastro com outro e-mail.\n\nFale com nossa equipe pelo link abaixo:\n\nhttps://wa.me/5565996933336";
export const EXPERIMENTAL_CLASS_TIME_BLOCKED_FINAL_MESSAGE =
  "Não foi possível validar o horário informado após 3 tentativas. Este cadastro foi bloqueado. Para tentar novamente, entre em contato com nosso suporte para desbloquear o e-mail utilizado ou realize um novo cadastro com outro e-mail.\n\nFale com nossa equipe pelo link abaixo:\n\nhttps://wa.me/5565996933336";

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
