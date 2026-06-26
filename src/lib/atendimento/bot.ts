import {
  CAPTURED_FIELD_ORDER,
  CAPTURED_FIELD_PROMPTS,
} from "./constants.ts";
import type { AtendimentoLead, AtendimentoStage, AtendimentoStatus, CapturedFieldName } from "./types.ts";

type CapturedData = Partial<Record<CapturedFieldName, string>>;

const YES_WORDS = ["sim", "quero", "vamos", "pode", "tenho interesse", "quero agendar", "agendar"];

export function initialBotMessages() {
  return [
    "Olá. Seja muito bem-vindo(a) ao Lucas Brum Online Music USA.",
    "Nossa metodologia foi criada para acelerar sua evolução musical com acompanhamento individual, clareza de rotina e foco prático.",
    "Quero te convidar para uma aula experimental e já adiantar o seu pré-cadastro por aqui.",
    CAPTURED_FIELD_PROMPTS.full_name,
  ];
}

export function extractLeadDataFromMessage(text: string): CapturedData {
  const clean = text.trim();
  if (!clean) return {};

  const result: CapturedData = {};
  const cpf = clean.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
  const email = clean.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phone = clean.match(/(?:\+?\d{1,3}\s*)?(?:\(?\d{2,3}\)?\s*)?\d(?:[\d\s-]){7,}\d/);
  const timezone = clean.match(/\b(?:America\/[A-Za-z_]+|GMT[+-]\d{1,2}|UTC[+-]\d{1,2})\b/i);
  const bestTime = clean.match(/\b(\d{1,2}[:h]\d{2}|\d{1,2}\s*(?:da manhã|da tarde|da noite))\b/i);

  if (cpf) result.cpf = cpf[0];
  if (email) result.email = email[0];
  if (phone) result.phone = phone[0];
  if (timezone) result.timezone = timezone[0];
  if (bestTime) result.best_contact_time = bestTime[0];

  if (!result.country) {
    const country = clean.match(/\b(brasil|brazil|estados unidos|usa|united states|canadá|canada|portugal)\b/i);
    if (country) result.country = country[0];
  }
  if (!result.state) {
    const state = clean.match(/\b(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)\b/i);
    if (state) result.state = state[0].toUpperCase();
  }
  if (!result.city) {
    const city = clean.match(/(?:moro em|cidade|city)\s*:?\s*([A-Za-zÀ-ÿ' -]{3,})/i);
    if (city?.[1]) result.city = city[1].trim();
  }
  if (!result.full_name && !email && !cpf && !phone && clean.split(" ").length >= 2) {
    result.full_name = clean.replace(/[0-9]/g, "").trim();
  }

  return result;
}

export function getNextMissingField(lead: Partial<AtendimentoLead>) {
  return (
    CAPTURED_FIELD_ORDER.find((field) => {
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
      message:
        "Perfeito. Seu pré-cadastro foi concluído e seu atendimento segue para matrícula pendente. Em breve continuaremos por aqui.",
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
