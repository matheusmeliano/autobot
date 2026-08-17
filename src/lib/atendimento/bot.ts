import {
  ACTIVE_CAPTURED_FIELD_ORDER,
  CAPTURED_FIELD_ORDER,
  CAPTURED_FIELD_PROMPTS,
  CONTRACT_FIELD_ORDER,
  CONTRACT_FIELD_PROMPTS,
  CONTRACT_FIELD_SKIP_WORDS,
  CONTRACT_OPTIONAL_FIELDS,
  EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE,
} from "./constants.ts";
import type { AtendimentoLead, AtendimentoStage, AtendimentoStatus, CapturedFieldName } from "./types.ts";

export type ContractFieldName = (typeof CONTRACT_FIELD_ORDER)[number];
export type ContractStageDecision =
  | { kind: "field"; field: ContractFieldName; prompt: string }
  | { kind: "awaiting_aceite"; prompt: string }
  | { kind: "signed" };

type CapturedData = Partial<Record<CapturedFieldName, string>>;

const YES_WORDS = ["sim", "quero", "vamos", "pode", "tenho interesse", "quero agendar", "agendar"];
const NAME_CONNECTORS = new Set(["da", "de", "do", "das", "dos", "e"]);
const GREETING_SINGLE_WORDS = new Set([
  "oi", "ola", "olá", "olaa", "oiie", "oie", "hey", "hi", "hello",
  "tchau", "bye", "obrigado", "obrigada", "obg", "valeu",
  "bom", "boa", "boanoite", "boatarde", "bomdia",
  "tudo", "bem", "tudobem", "ok", "okay", "okey", "certo", "claro",
  "sim", "nao", "não", "yes", "no",
  "qual", "que", "como", "onde", "quando", "quem", "porque", "porquê",
  "meu", "minha", "nome", "sou", "chamo",
  "tenho", "interesse", "quero", "agendar", "vamos", "pode",
  "aula", "experimental", "horario", "horário", "dia", "dias",
  "estado", "cidade", "morar", "moro", "resido", "vivo",
  "estados", "unidos", "brasil", "eua", "usa",
  "professor",
  "whatsapp", "zap", "whats", "telefone", "numero", "número",
  "senhor", "senhora", "senhorita", "sr", "sra", "srta", "dr", "dra",
]);

const GREETING_PHRASE_STARTS = [
  "oi ", "ola ", "olá ", "hey ", "hi ", "hello ", "tudo bem", "tudobem",
  "bom dia", "boa tarde", "boa noite", "como vai", "tudo bem com",
  "obrigado", "obrigada", "muito obrigado", "muito obrigada",
  "gostaria de", "queria saber", "quero saber",
  "meu nome", "sou o", "sou a", "eu sou", "me chamo",
  "qual o", "qual a", "quanto",
  "tem aula", "aula experimental", "agendar aula",
  "você tem", "voce tem", "funciona assim",
  "por favor", "porfavor", "pf ", "pfv ", "pode me", "me ajuda", "ajuda me",
  "tenho interesse", "quero agendar", "vamos la", "vamos lá", "bora la", "bora lá",
  "moro em", "resido em", "vivo em", "sou de",
];

const COMMON_FIRST_NAMES = new Set((`
Ana Maria Joana Mariana Juliana Julia Gabriela Beatriz Laura Isabella
Manuela Larissa Amanda Leticia Letícia Fernanda Bruna Camila Thaisa Thaísa
Thais Thayná Thainá Thayane Rafaela Rebeca Natalia Natália Luiza Luisa
Helena Heloisa Heloísa Melissa Bianca Carolina Yasmin Yasmim Nicole Evelyn
Pietra Pietra Esther Emanuelly Sarah Lavínia Lavinia Isadora Lorena Sophia
Sofia Marina Barbara Bárbara Vitória Vitoria Eduarda Alice Laís Lais
Alessandra Adriana Agatha Ágatha Alana Ana Beatriz Ana Clara Ana Julia
Ana Luiza Ana Rita Andréia Angela Angelina Antonella Ariane Aline Amanda
Amelia Amélia Ana Paula Andreza Anny Astrid Bia Beatrice Belinda Betina
Brenda Brena Carla Caroline Catarina Cecília Cecilia Celeste Clara Clarice
Cinthia Cintia Constança Cristiane Cristine Daniela Dandara Daiane Débora
Debora Denise Diana Dinara Domitila Eduarda Elayne Elaine Emanuelle Ester
Fabiana Fernanda Flávia Flavia Gabriella Geovanna Giovanna Giselle Glória
Gloria Graziele Heloise Hortência Iasmin Iasmim Iracema Isabela Isabele
Isis Ivana Jamily Janaina Jasmine Jéssica Jessica Jhenifer Júlia Julya
Karina Karen Kássia Kassia Kelly Késia Késsia Kethellen Ketyellen Kamily
Kamilla Karoline Kauane Késsia Ketlen Laís Lara Larissa Laryssa Laura
Leandra Leidiane Letícia Lígia Lila Lilian Lirian Lorrayne Lua Luciana
Luciene Luiza Luzia Mabel Maitê Maiara Marcele Marcela Maria Mariana
Marília Marilia Mariane Martina Matilde Mayara Medéia Micaela Michele
Mirela Morgana Mujerla Nayara Nívea Nivea Noara Núbia Nubia Olívia
Olivia Ornela Patrícia Patricia Paula Pâmela Pamela Paula Pietra Poliana
Quésia Quesia Quitéria Quiterya Rachel Rebeca Rafaela Regiane Rhaissa
Rhayssa Roberta Rodineide Rosana Rosália Rosália Sabrina Salete Samara
Samanta Samanthha Sâmia Samia Sara Selena Serena Shirleide Silvana Sirley
Sônia Sonia Stephany Suélen Suelen Suzana Tainá Thaiane Thalita Thayná
Thiara Thais Thaís Tiele Trícia Tricia Valéria Valéria Vânia Vania
Viviane Weruska Yanca Yara Yasmin Yngrid Zaira
João José Pedro Henrique Lucas Matheus Gustavo Felipe Leonardo Marcos
Luiz Paulo Ricardo Daniel Carlos Antonio Antônio Francisco Rafael Murilo
Anderson Guilherme Rodrigo Bruno Eduardo Thiago Vinicius André André
Artur Bernardo Caio César César Christian Cristian Diego Diogo Douglas
Enzo Erick Everton Fabrício Fabrizio Fernando Filipe Frederico Gabriel
Guilherme Heitor Hugo Igor Iago Israel Iuri Ivan Jeferson Jefferson
Jerônimo Jeronimo Jhonatan João Victor Joaquim Jorge José Julio Júlio
Juninho Justino Kelvin Kléber Kleber Kauê Kaue Kelvin Kenedy Kennedy
Kevin Kleyton Kleiton Leonardo Levi Lorenzo Luan Lucas Luciano Luís
Luis Marcos Marcelo Márcio Marcio Mário Mario Maurício Mauricio Maycon
Messias Miguel Moacir Nataniel Nathan Nélson Nelson Nicolas Nicolas
Nícolas Nivaldo Noé Noe Octávio Octavio Omar Orlando Otávio Octavio
Pablo Patrick Paulo Pedro Henrique Pedro Lucas Pedro Paulo Percy Pietro
Pablo Quentin Quirino Rafaelson Rainier Rafael Rômulo Romulo Ronaldo
Raul Reginaldo Renan Renato Ricardo Richard Roberto Rodrigo Roger Rogério
Rogério Ronaldo Rubens Ryan Samuel Sandro Saulo Sergio Sérgio Severino
Silvio Sócrates Socrates Stênio Stenio Steve Suélio Suelio Tadeu Thiago
Thiago Thomas Tiago Ulisses Umberto Úrsula Ursula Valentim Vanderson
Vanderlei Vasco Vicente Vitor Victor Wellington Wesley Willian William
Yuri Alexandre Alessandro Álvaro Alvaro Américo Americo Ângelo Angelo
Armindo Arnaldo Augusto Baltazar Benedito Benício Benicio Bruno Calebe
Camilo Cândido Candido Carlos Eduardo César Claudio Cláudio Cleber
Cléber Clayton Cleyton Cristiano Cristóvão Cristovão Cunha Damião Damiao
Danilo Davi Demétrio Demetrio Denílson Denilson Derick Diego Diogo
Domingos Dorival Dudu Emanuel Eneas Enzo Gabriel Erasmo Érico Eric
Evandro Fabiano Fábio Fabio Félix Felicio Felipe Fernão Flávio Flavio
Francinélio Francisco Francisco Franklin Geraldo Getúlio Getulio Gilberto
Gilmar Giovani Glauco Glauber Guilherme Gustavo Heitor Hernani Hilário
Hilario Horácio Horacio Hugo Iago Ilton Irineu Ismael Ivan Izaias
Jackson Jadson Jaime Janderson Jânio Janio Jean Jefferson Jessé Jesse
João Juninho Júlio Júnior Junior Justino Kalleb Kássio Kassio Kauê
Kévin Kevin Kléber Kleber Laerte Leandro Leonardo Léo Leo Leonardo
Lisandro Lourenço Lorenzo Lucena Lucas Luciano Luiz Manuel Marcelo Marcos
Marcos Vinícius Mariano Mário Marlon Maurício Melchior Mévio Mevio
Michel Miguel Milton Misael Natan Natanael Nélson Nelson Newton Nicolas
Nilton Nivaldo Noah Normando Octávio Olavo Orides Oscar Osvaldo Otávio
Otto Pablo Patrício Patrick Paulo Pedro Péricles Pericles Phelipe
Philipe Piero Plínio Plinio Quentin Quirino Rabi Rafael Ranieri Raul
Régis Regis Renan Renato Rhavan Ricardo Richard Roberto Rodrigo Roger
Rogério Ronaldo Roosevelt Rubens Ryan Sabino Salomão Samuel Santiago
Sávio Savio Sérgio Severino Silas Sílvio Silvio Sócrates Sérgio Sousa
Tadeu Tales Thiago Thomas Tiago Túlio Tulio Umberto Valdir Valentim
Valter Vanderlei Vasco Venício Venâncio Venâncio Veríssimo Vicente
Vitor Victor Wagner Washington Wellington Wesley William Wilson Xande
Yago Icaro Ícaro
Aarón Aaron Abigail Adalberto Adam Adriana Agustín Aitana Alan Albert
Alberto Alejandro Alex Alexander Alexandra Alexis Alice Alicia Amanda
Ana Andrea Andrew Andy Angel Angela Ann Anthony Antonio Ariana Ashley
Austin Ava Barbara Beatriz Belen Benjamin Ben Brad Brandon Brenda Brian
Bruce Caleb Cameron Carla Carlos Carmen Caroline Carter Catalina Cecilia
Charles Charlotte Chloe Christian Christopher Claudia Cody Connor Crystal
Cynthia Damian Daniel Danna David Diego Dolores Dylan Elena Eliana Elias
Elizabeth Ella Ellen Emily Emma Eric Ethan Eva Evelyn Faith Fernando
Frank Gabriel Gabriela George Gloria Grace Haley Heather Helen Henry
Ian Iris Isabela Jack Jacob Jacqueline Jade James Jamie Jane Jasmine
Jason Jennifer Jeremy Jessica Jim John Jordan Joseph Joshua Julia Justin
Katherine Kayla Kevin Kimberly Kylie Laura Lauren Leah Leonardo Liam
Lillian Lily Logan Lucia Luis Luke MacKenzie Madison Marc Marcus Maria
Marina Mark Martha Mary Matthew Maya Megan Melanie Melissa Michael
Michelle Mia Miguel Morgan Nancy Natalie Nathan Nicholas Nicole Noah
Olivia Oscar Owen Pamela Patricia Paula Paul Peter Rachel Rebecca Richard
Robert Ryan Samantha Sandra Sarah Scott Sebastian Sharon Sofia Sophia
Stephanie Steven Susan Taylor Thomas Tiffany Tyler Valentina Victoria
Virginia William Zachary Zoe
`).split(/\s+/).map(s => s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")).filter(Boolean));

function containsAnyEmojiOrSymbol(text: string): boolean {
  if (/[\p{Extended_Pictographic}\u200D]/u.test(text)) return true;
  if (/[!@#$%^&*(){}\[\];<>"?~`|+=♥•●■♦♣♠※★☆✓✔✕✖❤☺]/.test(text)) return true;
  return false;
}

function isLikelyGreetingOrPhrase(value: string): boolean {
  const lower = value.toLowerCase().trim();
  const lowerNoAccent = lower
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const noPunct = lowerNoAccent.replace(/[.,!?¿¡]/g, "").replace(/\s+/g, " ").trim();
  const words = noPunct.split(" ").filter(Boolean);

  if (words.length === 1) {
    return GREETING_SINGLE_WORDS.has(noPunct);
  }

  for (const start of GREETING_PHRASE_STARTS) {
    if (noPunct.startsWith(start)) return true;
  }

  const allGreetingOrStop = words.every((w) => GREETING_SINGLE_WORDS.has(w) || NAME_CONNECTORS.has(w));
  if (allGreetingOrStop && words.length <= 5) return true;

  if (/\?$/.test(lower)) return true;

  return false;
}

export function firstTwoNamesFromFullName(value: string | null | undefined) {
  const clean = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  const parts = clean.split(" ").filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0] ?? "";
  return `${parts[0]} ${parts[1]}`;
}

export function isValidCPF(value: string | null | undefined): { ok: boolean; digits: string; formatted: string } {
  const digits = String(value ?? "").replace(/\D+/g, "").slice(0, 11);
  if (digits.length !== 11) return { ok: false, digits, formatted: "" };
  if (/^(\d)\1+$/.test(digits)) return { ok: false, digits, formatted: "" };
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i] ?? "0") * (10 - i);
  let v1 = 11 - (sum % 11);
  if (v1 >= 10) v1 = 0;
  if (Number(digits[9] ?? "-1") !== v1) return { ok: false, digits, formatted: "" };
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i] ?? "0") * (11 - i);
  let v2 = 11 - (sum % 11);
  if (v2 >= 10) v2 = 0;
  if (Number(digits[10] ?? "-1") !== v2) return { ok: false, digits, formatted: "" };
  const formatted = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
  return { ok: true, digits, formatted };
}

export function looksLikeFullName(value: string) {
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean) return false;
  if (/\d/.test(clean)) return false;
  if (/[/:@\\]/.test(clean)) return false;
  if (/\b(?:america\/|gmt|utc)\b/i.test(clean)) return false;
  if (containsAnyEmojiOrSymbol(clean)) return false;

  if (isLikelyGreetingOrPhrase(clean)) return false;

  const parts = clean.split(" ").filter(Boolean);
  if (parts.length < 2 || parts.length > 6) return false;

  for (const part of parts) {
    if (part.length < 2 && !NAME_CONNECTORS.has(part.toLowerCase())) return false;
  }

  let significantParts = 0;
  let firstSignificantToken: string | null = null;
  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (NAME_CONNECTORS.has(normalized)) continue;
    if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*$/.test(part)) return false;
    if (GREETING_SINGLE_WORDS.has(normalized)) return false;
    const asciiNormalized = normalized
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (!firstSignificantToken) firstSignificantToken = asciiNormalized;
    significantParts += 1;
  }

  if (significantParts < 2) return false;
  if (!firstSignificantToken) return false;
  if (!COMMON_FIRST_NAMES.has(firstSignificantToken)) return false;

  return true;
}

export function filterCapturedDataForLead(params: {
  lead: Partial<AtendimentoLead>;
  captured: CapturedData;
  expectedField: CapturedFieldName | null;
}) {
  const next: CapturedData = {};

  for (const field of CAPTURED_FIELD_ORDER) {
    const value = String(params.captured[field] ?? "").trim();
    if (!value) continue;

    const currentValue = String((params.lead as any)?.[field] ?? "").trim();
    if (currentValue && params.expectedField !== field) continue;

    next[field] = value;
  }

  return next;
}

export function initialBotMessages(params?: { userName?: string | null }) {
  const fullClean = String(params?.userName ?? "").trim();
  const displayName = fullClean ? fullClean.split(/\s+/)[0] ?? "" : "";
  const welcomeMessage = displayName
    ? `Olá, ${displayName}! Seja muito bem-vindo(a) ao Lucas Brum Online Music USA.`
    : "Olá. Seja muito bem-vindo(a) ao Lucas Brum Online Music USA.";
  return [
    welcomeMessage,
    "Nossa metodologia inclui uma aula online ao vivo por semana, com acompanhamento individual.",
    "Quero te convidar para uma aula experimental!",
    CAPTURED_FIELD_PROMPTS.phone,
  ];
}

export function fieldFromBotPrompt(promptText: unknown): CapturedFieldName | null {
  const raw = String(promptText ?? "").trim();
  if (!raw) return null;
  const entries = Object.entries(CAPTURED_FIELD_PROMPTS) as Array<[CapturedFieldName, string]>;
  for (const [field, prompt] of entries) {
    if (String(prompt).trim() === raw) return field;
  }
  return null;
}

export function extractLeadDataFromMessage(text: string): CapturedData {
  const clean = text.trim();
  if (!clean) return {};

  const result: CapturedData = {};

  if (!result.full_name) {
    const explicitName = clean.match(/(?:meu nome(?: completo)?\s*(?:é|e)?|sou)\s+([A-Za-zÀ-ÿ'’ -]{3,})/i);
    const explicitValue = explicitName?.[1]?.trim() ?? "";
    if (explicitValue && looksLikeFullName(explicitValue)) {
      result.full_name = explicitValue;
    }
  }
  if (
    !result.full_name &&
    looksLikeFullName(clean)
  ) {
    result.full_name = clean.replace(/\s+/g, " ").trim();
  }

  return result;
}

export function getNextMissingField(lead: Partial<AtendimentoLead>, orderOverride?: ReadonlyArray<CapturedFieldName>) {
  const order = orderOverride ?? ACTIVE_CAPTURED_FIELD_ORDER;
  return (
    order.find((field) => {
      const value = String((lead as any)?.[field] ?? "").trim();
      return !value;
    }) ?? null
  );
}

export function inferNextStage(params: {
  currentStage: AtendimentoStage;
  messageText: string;
  hasCompletedPreCadastro: boolean;
}) {
  const text = params.messageText.trim().toLowerCase();
  if (params.hasCompletedPreCadastro) return "pre_cadastro_concluido" as AtendimentoStage;
  if (YES_WORDS.some((word) => text.includes(word))) {
    return "aula_experimental_agendada" as AtendimentoStage;
  }
  if (params.currentStage === "novo_lead") return "em_atendimento" as AtendimentoStage;
  if (params.currentStage === "em_atendimento") return "metodologia_apresentada" as AtendimentoStage;
  if (params.currentStage === "metodologia_apresentada") {
    return "aula_experimental_convidada" as AtendimentoStage;
  }
  return params.currentStage;
}

export function inferStatusFromStage(stage: AtendimentoStage): AtendimentoStatus {
  if (stage === "matriculado") return "matriculado";
  if (stage === "encerrado") return "encerrado";
  if (stage === "contrato_coletando_dados") return "contrato_coletando_dados";
  if (stage === "contrato_aguardando_aceite") return "contrato_aguardando_aceite";
  if (stage === "contrato_assinado") return "contrato_assinado";
  if (stage === "pre_cadastro_concluido" || stage === "matricula_pendente") {
    return "matricula_pendente";
  }
  if (stage === "novo_lead") return "novo_lead";
  return "em_atendimento";
}

export function botReplyForLead(params: {
  lead: Partial<AtendimentoLead>;
  messageText: string;
}) {
  const nextField = getNextMissingField(params.lead);
  if (!nextField) {
    return {
      stage: "pre_cadastro_concluido" as AtendimentoStage,
      status: "matricula_pendente" as AtendimentoStatus,
      message: EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE,
    };
  }

  const nextStage = inferNextStage({
    currentStage: (params.lead.funnel_stage as AtendimentoStage) || "novo_lead",
    messageText: params.messageText,
    hasCompletedPreCadastro: false,
  });
  return {
    stage: nextStage,
    status: inferStatusFromStage(nextStage),
    message: CAPTURED_FIELD_PROMPTS[nextField],
  };
}

function contractFieldValueOrNull(
  lead: Partial<AtendimentoLead>,
  field: ContractFieldName,
): string | null {
  const raw = String((lead as Record<string, unknown>)[field] ?? "").trim();
  return raw || null;
}

export function getNextContractField(
  lead: Partial<AtendimentoLead>,
  overrideValues?: Partial<Record<ContractFieldName, string | null>>,
): ContractFieldName | null {
  const overrides = overrideValues ?? {};
  return (
    CONTRACT_FIELD_ORDER.find((field) => {
      const raw =
        typeof overrides[field] !== "undefined"
          ? String(overrides[field] ?? "").trim()
          : contractFieldValueOrNull(lead, field) ?? "";
      const hasValue = Boolean(raw);
      if (hasValue) return false;
      if (CONTRACT_OPTIONAL_FIELDS.has(field as typeof CONTRACT_OPTIONAL_FIELDS extends Set<infer T> ? T : never)) return true;
      return true;
    }) ?? null
  );
}

export function normalizeContractFieldSkip(raw: string): boolean {
  const text = String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return false;
  return CONTRACT_FIELD_SKIP_WORDS.some((w) => {
    const wNorm = String(w ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    if (!wNorm) return false;
    return text === wNorm || text.includes(wNorm);
  });
}

export type ContractFieldValidationResult =
  | { ok: true; value: string }
  | { ok: true; skipped: true; value: null }
  | { ok: false; reason: string };

function looksLikePhoneInternational(raw: string): boolean {
  const digits = String(raw ?? "").replace(/\D+/g, "").slice(0, 16);
  if (digits.length < 11) return false;
  if (!digits.startsWith("55") && !digits.startsWith("1")) return false;
  return true;
}

export function validateContractFieldValue(
  field: ContractFieldName,
  raw: string | null | undefined,
): ContractFieldValidationResult {
  const text = String(raw ?? "").trim();

  if (
    CONTRACT_OPTIONAL_FIELDS.has(field as typeof CONTRACT_OPTIONAL_FIELDS extends Set<infer T> ? T : never) &&
    normalizeContractFieldSkip(text)
  ) {
    return { ok: true, skipped: true, value: null };
  }

  if (!text) {
    return { ok: false, reason: "Campo obrigatório não preenchido." };
  }

  if (field === "full_name") {
    if (!looksLikeFullName(text)) {
      return {
        ok: false,
        reason:
          "Informe nome e sobrenome válidos (somente letras, sem números ou símbolos).",
      };
    }
    return { ok: true, value: text.replace(/\s+/g, " ").trim() };
  }

  if (field === "legal_responsible_name") {
    if (!looksLikeFullName(text)) {
      return {
        ok: false,
        reason:
          "Informe nome e sobrenome válidos do responsável, ou responda “pular” se não se aplicar.",
      };
    }
    return { ok: true, value: text.replace(/\s+/g, " ").trim() };
  }

  if (field === "cpf" || field === "legal_responsible_cpf") {
    const validation = isValidCPF(text);
    if (!validation.ok) {
      if (field === "legal_responsible_cpf") {
        return {
          ok: false,
          reason:
            "CPF do responsável inválido. Verifique e tente novamente (11 dígitos), ou responda “pular” se não se aplicar.",
        };
      }
      return {
        ok: false,
        reason:
          "CPF inválido. Verifique e tente novamente (11 dígitos, com ou sem pontos e traço).",
      };
    }
    return { ok: true, value: validation.digits };
  }

  if (field === "phone") {
    if (!looksLikePhoneInternational(text)) {
      return {
        ok: false,
        reason:
          "Informe um WhatsApp válido com código do país (+55 para Brasil ou +1 para Estados Unidos).",
      };
    }
    const digits = String(text ?? "").replace(/\D+/g, "").slice(0, 16);
    return { ok: true, value: digits.startsWith("+") ? digits : `+${digits}` };
  }

  return { ok: true, value: text };
}

export function buildContractFieldPrompt(
  lead: Partial<AtendimentoLead>,
  nextField: ContractFieldName,
): string {
  const existing = contractFieldValueOrNull(lead, nextField);
  if (nextField === "full_name" && existing) {
    return `Confirme se seu nome completo está correto:\n\n${existing}\n\nSe estiver correto, basta responder “sim”. Se precisar corrigir, envie o nome completo correto.`;
  }
  if (nextField === "phone" && existing) {
    return `Confirme se seu WhatsApp está correto para o contrato:\n\n${existing}\n\nSe estiver correto, basta responder “sim”. Se precisar corrigir, envie o número completo com código do país.`;
  }
  if (nextField === "cpf" && existing) {
    const validation = isValidCPF(existing);
    const formatted = validation.ok ? validation.formatted : existing;
    return `Confirme seu CPF para o contrato:\n\n${formatted}\n\nSe estiver correto, basta responder “sim”. Se precisar corrigir, envie o CPF correto (11 dígitos).`;
  }
  return CONTRACT_FIELD_PROMPTS[nextField];
}

export function detectContractYesConfirmation(rawMessage: string): boolean {
  const normalized = String(rawMessage ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  if (normalized === "sim" || normalized === "s") return true;
  return /\b(sim|confirmo|confirmado|esta correto|esta certo|correto|certo|ok|de acordo|concordo|esta tudo certo)\b/.test(
    normalized,
  );
}
