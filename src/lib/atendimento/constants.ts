export const ATENDIMENTO_EMAIL = "atendimento.usa.music@gmail.com";
export const ATENDIMENTO_PUBLIC_LINK_SLUG = "lucas-brum-online-music-usa";

export const ATENDIMENTO_DAILY_SUMMARY_PHONE = "+55 65 9985-1142";

export const BRASIL_DDI = "55";
export const US_DDI = "1";
export const ALLOWED_BRASIL_PHONES_DIGITS: readonly string[] = [
  "5565996933336",
  "556581175345",
];

export const ZAPI_INTERNAL_PHONE_BLOCKLIST_SUFFIX_10: readonly string[] = [];

export const OWNER_PERSONAL_PRIVATE_PHONE_SUFFIXES_10: readonly string[] = [];

export const BOT_DEDICATED_EXCLUSIVE_PHONE_SUFFIXES_10: readonly string[] = [];

export function normalizePhoneToDigits(raw: unknown): string {
  return String(raw ?? "").replace(/\D+/g, "");
}

export function isAllowedPhoneInbound(rawPhone: unknown): boolean {
  const digits = normalizePhoneToDigits(rawPhone);
  if (!digits) return true;
  if (digits.startsWith(US_DDI)) return true;
  if (ALLOWED_BRASIL_PHONES_DIGITS.includes(digits)) return true;
  return !digits.startsWith(BRASIL_DDI);
}

export function isBlockedBrasilPhone(rawPhone: unknown): boolean {
  const digits = normalizePhoneToDigits(rawPhone);
  if (!digits) return false;
  if (digits.startsWith(US_DDI)) return false;
  if (ALLOWED_BRASIL_PHONES_DIGITS.includes(digits)) return false;
  return digits.startsWith(BRASIL_DDI);
}

function matchBrazilianPhoneSuffix(digitsRaw: string | null | undefined, suffixesList: readonly string[]): boolean {
  return false;
}

export function isZapiInternalBlocklistedPhone(_digitsRaw: string | null | undefined): boolean {
  return false;
}

export function isOwnerPersonalPrivatePhone(_digitsRaw: string | null | undefined): boolean {
  return false;
}

export function isDedicatedExclusiveBotPhone(_digitsRaw: string | null | undefined): boolean {
  return true;
}

export const ATENDIMENTO_STAGE_ORDER = [
  "novo_lead", "em_atendimento", "metodologia_apresentada", "aula_experimental_convidada",
  "aula_experimental_agendada", "pre_cadastro_concluido", "matricula_pendente",
  "matricula_pendente_recusada", "cadastro_recorrente_pendente_plataforma",
  "contrato_coletando_dados", "contrato_aguardando_aceite", "contrato_assinado",
  "aluno_recorrente_cadastrado", "pagamento_pendente_confirmacao", "pagamento_nao_realizado",
  "matricula_confirmada", "matriculado", "repescagem", "encerrado",
] as const;

export const ATENDIMENTO_STATUS_ORDER = [
  "novo_lead", "em_atendimento", "matricula_pendente", "matricula_pendente_recusada",
  "cadastro_recorrente_pendente_plataforma", "contrato_coletando_dados",
  "contrato_aguardando_aceite", "contrato_assinado", "aluno_recorrente_cadastrado",
  "pagamento_pendente_confirmacao", "pagamento_nao_realizado", "matricula_confirmada",
  "matriculado", "aluno", "repescagem", "encerrado",
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
] as const;

export const CONTRACT_FIELD_ORDER = [
  "full_name",
] as const;

export const CONTRACT_FIELD_LABELS: Record<(typeof CONTRACT_FIELD_ORDER)[number], string> = {
  full_name: "Nome completo",
};

export const CONTRACT_OPTIONAL_FIELDS = new Set([] as const);

export const CONTRACT_FIELD_PROMPTS: Record<(typeof CONTRACT_FIELD_ORDER)[number], string> = {
  full_name: "Para confirmarmos a matrícula, confirme seu nome completo.",
};

export const CONTRACT_FIELD_SKIP_WORDS = [
  "pular",
  "pulado",
  "pula",
] as const;

export const CONTRACT_ACEITE_PROMPT_FIRST =
  "Perfeito! Agora vamos confirmar sua matrícula. Em seguida você poderá visualizar e baixar a confirmação completa em PDF.\n\nResponda “sim” para declarar que leu, compreendeu e concorda com as condições, ou “não” para revisar os dados novamente.";

export const CONTRACT_ACEITE_PROMPT_RETRY =
  "Responda apenas “sim” para declarar que leu, compreendeu e concorda com a confirmação de matrícula, ou “não” para revisar os dados novamente.";

export const CONTRACT_SIGNED_SUCCESS_MESSAGE =
  "Matrícula confirmada com sucesso! O PDF com todas as informações foi gerado e está disponível para download.\n\nVocê também pode baixá-lo novamente a qualquer momento no painel do aluno ou entrando em contato com a nossa equipe.";

export const CONTRACT_INVALID_MESSAGE = (fieldLabel: string): string =>
  `Não foi possível validar ${fieldLabel} informado. Responda novamente com os dados corretos.`;

export const CAPTURED_FIELD_PROMPTS: Record<(typeof CAPTURED_FIELD_ORDER)[number], string> = {
  full_name: "Qual é o seu nome e sobrenome?",
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
  "Agora é só escolher o melhor dia e horário para sua aula experimental, COM BASE NO HORÁRIO DA SUA CIDADE.";
export const EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE = "Para começarmos, qual dia você prefere?";
export function buildExperimentalClassDatePromptMessages(name?: string | null) {
  const safeFull = String(name ?? "").trim();
  const safeFirst = safeFull.split(/\s+/)[0] || "Aluno";
  return [
    `${safeFirst}, agora é só escolher o melhor dia e horário para sua aula experimental, COM BASE NO HORÁRIO DA SUA CIDADE.`,
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
  matricula_pendente_recusada: "Matrícula Pendente (Recusada)",
  cadastro_recorrente_pendente_plataforma: "Cadastro Recorrente Pendente",
  contrato_coletando_dados: "Contrato: Coletando Dados",
  contrato_aguardando_aceite: "Contrato: Aguardando Aceite",
  contrato_assinado: "Contrato Assinado",
  aluno_recorrente_cadastrado: "Aluno Recorrente Cadastrado",
  pagamento_pendente_confirmacao: "Pagamento Pendente de Confirmação",
  pagamento_nao_realizado: "Pagamento Não Realizado",
  matricula_confirmada: "Matrícula Confirmada",
  matriculado: "Matrícula Concluída",
  repescagem: "",
  encerrado: "Encerrado",
};

export const STATUS_LABELS: Record<string, string> = {
  novo_lead: "Novo Lead",
  em_atendimento: "Em Atendimento",
  matricula_pendente: "Matrícula Pendente",
  matricula_pendente_recusada: "Matrícula Pendente (Recusada)",
  cadastro_recorrente_pendente_plataforma: "Cadastro Recorrente Pendente",
  contrato_coletando_dados: "Contrato: Coletando Dados",
  contrato_aguardando_aceite: "Contrato: Aguardando Aceite",
  contrato_assinado: "Contrato Assinado",
  aluno_recorrente_cadastrado: "Aluno Recorrente Cadastrado",
  pagamento_pendente_confirmacao: "Pagamento Pendente de Confirmação",
  pagamento_nao_realizado: "Pagamento Não Realizado",
  matricula_confirmada: "Matrícula Confirmada",
  matriculado: "Matrícula Concluída",
  aluno: "Aluno",
  repescagem: "",
  encerrado: "Encerrado",
};
