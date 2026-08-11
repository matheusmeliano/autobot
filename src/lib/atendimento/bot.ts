import {
  ACTIVE_CAPTURED_FIELD_ORDER,
  CAPTURED_FIELD_ORDER,
  CAPTURED_FIELD_PROMPTS,
  EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE,
} from "./constants.ts";
import type { AtendimentoLead, AtendimentoStage, AtendimentoStatus, CapturedFieldName } from "./types.ts";

type CapturedData = Partial<Record<CapturedFieldName, string>>;

const YES_WORDS = ["sim", "quero", "vamos", "pode", "tenho interesse", "quero agendar", "agendar"];
const NAME_CONNECTORS = new Set(["da", "de", "do", "das", "dos", "e"]);

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

  const parts = clean.split(" ").filter(Boolean);
  if (parts.length < 2 || parts.length > 6) return false;

  let significantParts = 0;
  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (NAME_CONNECTORS.has(normalized)) continue;
    if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*$/.test(part)) return false;
    significantParts += 1;
  }

  return significantParts >= 2;
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
