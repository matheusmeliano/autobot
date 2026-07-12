import {
  CAPTURED_FIELD_ORDER,
  CAPTURED_FIELD_PROMPTS,
  EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE,
} from "./constants.ts";
import type { AtendimentoLead, AtendimentoStage, AtendimentoStatus, CapturedFieldName } from "./types.ts";

type CapturedData = Partial<Record<CapturedFieldName, string>>;

const YES_WORDS = ["sim", "quero", "vamos", "pode", "tenho interesse", "quero agendar", "agendar"];
const NAME_CONNECTORS = new Set(["da", "de", "do", "das", "dos", "e"]);

function firstNameFromFullName(value: string | null | undefined) {
  const clean = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.split(" ")[0] ?? "";
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
  const firstName = firstNameFromFullName(params?.userName);
  const welcomeMessage = firstName
    ? `Olá, ${firstName}! Seja muito bem-vindo(a) ao Lucas Brum Online Music USA.`
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
  const phone = clean.match(/(?:\+?\d{1,3}\s*)?(?:\(?\d{2,3}\)?\s*)?\d(?:[\d\s-]){7,}\d/);

  if (phone) result.phone = phone[0];
  if (!result.full_name) {
    const explicitName = clean.match(/(?:meu nome(?: completo)?\s*(?:é|e)?|sou)\s+([A-Za-zÀ-ÿ'’ -]{3,})/i);
    const explicitValue = explicitName?.[1]?.trim() ?? "";
    if (explicitValue && looksLikeFullName(explicitValue)) {
      result.full_name = explicitValue;
    }
  }
  if (
    !result.full_name &&
    !phone &&
    looksLikeFullName(clean)
  ) {
    result.full_name = clean.replace(/\s+/g, " ").trim();
  }

  return result;
}

export function getNextMissingField(lead: Partial<AtendimentoLead>) {
  return (
    CAPTURED_FIELD_ORDER.find((field) => {
      if (field === "full_name" && String(lead.phone ?? "").trim()) {
        return false;
      }
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
