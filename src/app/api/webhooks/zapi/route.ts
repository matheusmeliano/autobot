import crypto from "node:crypto";
import OpenAI from "openai";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { confirmExecutedSchedulePaymentForUser } from "@/app/app/agenda/actions";
import { syncDebtorChargeStatus } from "@/lib/debtorChargeStatus";
import { botReplyForLead, getNextMissingField } from "@/lib/atendimento/bot";
import {
  ATENDIMENTO_PROFESSOR_TIME_ZONE,
  buildExperimentalClassDatePromptMessages,
  CAPTURED_FIELD_PROMPTS,
  EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE,
  EXPERIMENTAL_CLASS_DATE_INVALID_MESSAGE,
  EXPERIMENTAL_CLASS_TIME_INVALID_MESSAGE,
  LOCATION_STATE_INVALID_MESSAGE,
  LOCATION_CITY_INVALID_MESSAGE,
  WHATSAPP_REGISTERED_SUCCESS_MESSAGE,
} from "@/lib/atendimento/constants";
import {
  buildExperimentalClassAttendantWhatsAppMessage,
  buildExperimentalClassBookingChatMessages,
  buildExperimentalClassDatesMessages,
  buildExperimentalClassFinalChatMessages,
  buildExperimentalClassStudentWhatsAppMessages,
  buildExperimentalClassTimesMessages,
  EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
  EXPERIMENTAL_CLASS_DURATION_MINUTES,
  EXPERIMENTAL_CLASS_FINAL_WAIT_MESSAGE,
  EXPERIMENTAL_CLASS_POST_NOTIFICATION_WAIT_MESSAGE,
  findExperimentalClassDateOption,
  findExperimentalClassTimeOption,
  listExperimentalClassAvailability,
} from "@/lib/atendimento/experimentalClass";
import {
  appendHistoryEvent,
  ensureWhatsAppLeadAndConversation,
  hasAnyBotMessage,
  sendAtendimentoWhatsAppText,
  syncConversationPreview,
  getZapiInstanceMeta,
} from "@/lib/atendimento/server";
import {
  inferBrazilianLocationFromDdd,
  resolveTimeZoneFromCityInput,
  resolveTimeZoneFromStateInput,
} from "@/lib/timezone";

export const runtime = "nodejs";
const MAX_PHONE_VALIDATION_ATTEMPTS = 3;
const WHATSAPP_INVALID_MESSAGE =
  "Não foi possível validar esse número de WhatsApp. Por favor, informe um WhatsApp válido com o código do país no início (+55 para Brasil ou +1 para Estados Unidos).";
const WHATSAPP_INVALID_FINAL_MESSAGE =
  "Não foi possível validar seu número de WhatsApp após 3 tentativas. Este cadastro foi bloqueado. Para tentar novamente, entre em contato com nosso suporte para desbloquear o e-mail utilizado ou realize um novo cadastro com outro e-mail.\n\nFale com nossa equipe pelo link abaixo:\n\nhttps://wa.me/5565996933336";
const WHATSAPP_TECHNICAL_TIMEOUT_MESSAGE =
  "Nao foi possivel concluir a validacao do seu WhatsApp neste momento por instabilidade tecnica. Tente novamente em instantes.";

function normalizePhone(phone: string) {
  const raw = String(phone ?? "").trim();
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (raw.startsWith("+")) return d;
  if (d.startsWith("55")) return d;
  if (d.startsWith("1") && d.length === 11) return d;
  if (d.length === 11) return `55${d}`;
  return d;
}

function isValidWhatsAppUserPhone(digitsOnly: string): boolean {
  const d = String(digitsOnly ?? "").replace(/\D/g, "");
  if (!d) return false;
  if (!/^\d+$/.test(d)) return false;
  if (/^0+$/.test(d)) return false;
  if (d.length < 10) return false;
  if (d.length > 15) return false;
  if (d.startsWith("0")) return false;
  if (d.startsWith("550")) return false;
  if (d.startsWith("55")) {
    if (d.length !== 12 && d.length !== 13) return false;
    const rest = d.slice(2);
    if (/^0+/.test(rest)) return false;
    return true;
  }
  if (d.startsWith("1")) {
    if (d.length !== 11) return false;
    const npa = d.slice(1, 4);
    if (!/^[2-9]\d{2}$/.test(npa)) return false;
    return true;
  }
  const firstDigit = Number(d[0]);
  if (!Number.isFinite(firstDigit) || firstDigit < 2) return false;
  return true;
}

function normalizeAndValidateFromPhone(phone: unknown): {
  normalized: string;
  digitsOnly: string;
  valid: boolean;
  invalidReason?: string;
} {
  const raw = String(phone ?? "").trim();
  if (!raw) {
    return { normalized: "", digitsOnly: "", valid: false, invalidReason: "empty_phone" };
  }
  const normalized = normalizePhone(raw);
  const digitsOnly = normalized.replace(/\D/g, "");
  if (!digitsOnly) {
    return { normalized: "", digitsOnly: "", valid: false, invalidReason: "empty_digits" };
  }
  if (!isValidWhatsAppUserPhone(digitsOnly)) {
    return {
      normalized,
      digitsOnly,
      valid: false,
      invalidReason: "invalid_user_phone_format",
    };
  }
  return { normalized, digitsOnly, valid: true };
}

function isAuthorized(req: Request) {
  const secret = process.env.ZAPI_WEBHOOK_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  const q = url.searchParams.get("secret");
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  return q === secret || bearer === secret;
}

function extractString(v: unknown) {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function getFirstNonEmpty(...values: Array<unknown>) {
  for (const v of values) {
    const s = extractString(v).trim();
    if (s) return s;
  }
  return "";
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buildPhoneValidationRetryMessage(attempts: number) {
  return `${WHATSAPP_INVALID_MESSAGE}\n\nTentativa ${attempts} de ${MAX_PHONE_VALIDATION_ATTEMPTS}.`;
}

function normalizeValidationErrorText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isExplicitInvalidWhatsAppError(error: unknown) {
  const message = normalizeValidationErrorText(error);
  if (!message) return false;
  return (
    message.includes("phone number does not exist") ||
    message.includes("numero nao existe") ||
    message.includes("number does not exist") ||
    message.includes("nao possui whatsapp") ||
    message.includes("not on whatsapp") ||
    message.includes("whatsapp number does not exist")
  );
}

async function upsertCapturedPhoneField(params: {
  leadId: string;
  sourceMessageId: string;
  phone: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("atendimento_captured_fields")
    .select("id")
    .eq("lead_id", params.leadId)
    .eq("field_name", "phone")
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from("atendimento_captured_fields")
      .update({
        field_value: params.phone,
        source_message_id: params.sourceMessageId,
        confidence: 0.92,
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(existing.id));
    return;
  }

  await admin.from("atendimento_captured_fields").insert({
    lead_id: params.leadId,
    field_name: "phone",
    field_value: params.phone,
    source_message_id: params.sourceMessageId,
    confidence: 0.92,
  });
}

async function listScheduledExperimentalClassProfessorStarts(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  nowIso: string;
}) {
  const { data, error } = await params.admin
    .from("atendimento_experimental_class_bookings")
    .select("professor_start_at")
    .eq("status", "scheduled")
    .gte("professor_start_at", params.nowIso)
    .order("professor_start_at", { ascending: true });

  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  const tableMissing =
    Boolean(error) &&
    (code === "42P01" ||
      code === "PGRST205" ||
      /relation .*atendimento_experimental_class_bookings.*does not exist/i.test(message) ||
      /could not find the table .*atendimento_experimental_class_bookings.* in the schema cache/i.test(message));
  if (error && !tableMissing) {
    throw new Error(error.message || "Falha ao consultar horários ocupados da aula experimental.");
  }

  const { data: historyData, error: historyError } = await params.admin
    .from("atendimento_history_events")
    .select("details")
    .eq("event_type", "experimental_class_scheduled")
    .order("created_at", { ascending: true });

  if (historyError) {
    throw new Error(historyError.message || "Falha ao consultar horários ocupados da aula experimental.");
  }

  return Array.from(
    new Set([
      ...(!tableMissing ? (data ?? []).map((row) => String((row as any)?.professor_start_at ?? "").trim()) : []),
      ...(historyData ?? []).map((row) => String(((row as any)?.details ?? {}).professor_start_at ?? "").trim()),
    ]),
  ).filter((value) => value && value >= params.nowIso);
}

async function findPendingPhoneValidationEvent(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  messageIds: string[];
}) {
  for (const messageId of params.messageIds) {
    if (!messageId) continue;
    const { data: byMessageId } = await params.admin
      .from("atendimento_history_events")
      .select("id, lead_id, conversation_id, details")
      .eq("event_type", "phone_validation_pending")
      .contains("details", { external_message_id: messageId })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byMessageId?.id) {
      return byMessageId as any;
    }

    const { data: byZaapId } = await params.admin
      .from("atendimento_history_events")
      .select("id, lead_id, conversation_id, details")
      .eq("event_type", "phone_validation_pending")
      .contains("details", { external_zaap_id: messageId })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byZaapId?.id) {
      return byZaapId as any;
    }
  }

  return null;
}

async function getPhoneValidationFailureCount(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
}) {
  const { count } = await params.admin
    .from("atendimento_history_events")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", params.leadId)
    .eq("conversation_id", params.conversationId)
    .in("event_type", ["phone_validation_format_failed", "phone_validation_failed"]);

  return Number(count ?? 0);
}

const POSITIVE_TEXT_SNIPPETS = [
  "pagamento realizado",
  "pix feito",
  "pix realizado",
  "pix pago",
  "pagamento efetuado",
  "ja paguei",
  "acabei de pagar",
  "efetuei o pagamento",
  "transferencia realizada",
  "valor pago",
  "conta quitada",
  "debito quitado",
  "mensalidade paga",
  "tudo certo com o pagamento",
  "envio de comprovante",
  "segue comprovante",
  "comprovante em anexo",
  "enviando comprovante",
  "comprovante do pagamento",
  "comprovante enviado",
  "anexei o comprovante",
  "print do pagamento",
  "print do pix",
  "comprovante pix",
  "recibo do pagamento",
  "evidencia do pagamento",
  "anexo do pagamento",
  "pago",
  "paguei",
  "ja foi pago",
  "ja esta pago",
  "feito",
  "resolvido",
  "tudo pago",
  "esta quitado",
  "pagamento concluido",
  "pix enviado",
  "transferido",
  "acabei de fazer o pix",
  "ok, pago",
  "pago agora",
  "enviei o pix",
  "confira o pix",
  "pode verificar",
  "da uma olhada",
  "confirma ai",
  "recebeu?",
];

const NEGATIVE_TEXT_SNIPPETS = [
  "vou pagar",
  "pagarei",
  "pago amanha",
  "vou fazer o pix",
  "vou fazer pix",
  "manda o pix",
  "manda sua chave",
  "qual a chave",
  "posso pagar",
  "como posso pagar",
];

function extractMediaInfo(body: any) {
  const mediaUrl = getFirstNonEmpty(
    body?.image?.url,
    body?.imageUrl,
    body?.media?.url,
    body?.file?.url,
    body?.document?.url,
    body?.message?.image?.url,
    body?.message?.document?.url,
    body?.message?.file?.url,
    body?.data?.image?.url,
    body?.data?.media?.url,
    body?.data?.file?.url,
    body?.data?.document?.url,
    body?.data?.message?.image?.url,
    body?.data?.message?.document?.url,
    body?.data?.message?.file?.url,
    Array.isArray(body?.messages) ? body?.messages?.[0]?.image?.url : "",
    Array.isArray(body?.messages) ? body?.messages?.[0]?.document?.url : "",
  );

  const typeSource = normalizeText(
    getFirstNonEmpty(
      body?.type,
      body?.event,
      body?.eventType,
      body?.message?.type,
      body?.message?.mimetype,
      body?.message?.mimeType,
      body?.data?.type,
      body?.data?.event,
      body?.data?.message?.type,
      body?.data?.message?.mimetype,
      body?.data?.message?.mimeType,
      Array.isArray(body?.messages) ? body?.messages?.[0]?.type : "",
      Array.isArray(body?.messages) ? body?.messages?.[0]?.mimetype : "",
    ),
  );

  const hasImageFlag =
    Boolean(body?.image || body?.message?.image || body?.data?.image || body?.data?.message?.image) ||
    typeSource.includes("image") ||
    typeSource.includes("imagem");
  const hasDocumentFlag =
    Boolean(body?.document || body?.message?.document || body?.data?.document || body?.data?.message?.document) ||
    typeSource.includes("document") ||
    typeSource.includes("arquivo") ||
    typeSource.includes("application/");

  return {
    mediaUrl,
    hasPaymentMedia: Boolean(mediaUrl || hasImageFlag || hasDocumentFlag),
  };
}

function heuristicPaymentDetection(params: { text: string; mediaUrl?: string | null; hasPaymentMedia?: boolean }) {
  const t = normalizeText(params.text || "");
  const hasMedia = Boolean(params.hasPaymentMedia || (params.mediaUrl || "").trim());
  const positive = POSITIVE_TEXT_SNIPPETS.some((snippet) => t.includes(snippet));
  const negative = NEGATIVE_TEXT_SNIPPETS.some((snippet) => t.includes(snippet));

  const isPayment = (positive || hasMedia) && !negative;
  if (!isPayment) {
    return { ok: false as const };
  }
  return {
    ok: true as const,
    result: {
      is_payment_proof: true,
      confidence: hasMedia ? 0.9 : 0.8,
      reason: hasMedia ? "Imagem/anexo recebido como potencial comprovante." : "Confirmação textual de pagamento detectada.",
      raw: { source: "heuristic", positive, negative, hasMedia },
    },
  };
}

const MAX_LOCATION_WHATSAPP_ATTEMPTS = 3;
const MAX_SCHEDULE_WHATSAPP_ATTEMPTS = 3;

function isValidCityInput(raw: string): { valid: boolean; reason?: string } {
  const value = String(raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return { valid: false, reason: "empty" };
  if (value.length < 3) return { valid: false, reason: "too_short" };
  if (/^[a-z]+$/.test(value) && value.length >= 10) {
    const vowels = (value.match(/[aeiou]/g) ?? []).length;
    const consonants = (value.match(/[bcdfghjklmnpqrstvwxyz]/g) ?? []).length;
    const total = vowels + consonants;
    if (total >= 10 && vowels / total < 0.2) return { valid: false, reason: "low_vowels" };
    const unique = new Set(value.split("")).size;
    if (unique / value.length < 0.55) return { valid: false, reason: "low_unique" };
  }
  if (!/[aeiou]/.test(value)) return { valid: false, reason: "no_vowels" };
  return { valid: true };
}

function cityResolutionIsReliable(
  resolution: ReturnType<typeof resolveTimeZoneFromCityInput> | null,
): resolution is NonNullable<ReturnType<typeof resolveTimeZoneFromCityInput>> {
  if (!resolution) return false;
  if (resolution.source === "city_match") return true;
  if (resolution.source === "state_match") return true;
  return false;
}

const SUPPORT_FINAL_MESSAGE = `Não foi possível concluir este agendamento.

Para continuar, entre em contato com nosso suporte pelo WhatsApp:

+55 (65) 9 9693-3336

Nossa equipe dará continuidade ao seu atendimento o mais breve possível.`;

async function sendSupportFinalAndMarkBlocked(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
  normalizedPhoneOnly: string;
  blockedStage: "state" | "city" | "date" | "time";
  attempt: number;
  contentText?: string | null;
}) {
  const nowIso = new Date().toISOString();
  void params.admin
    .from("atendimento_leads")
    .update({ status: "encerrado", funnel_stage: "encerrado", updated_at: nowIso })
    .eq("id", params.leadId);
  void params.admin
    .from("atendimento_conversations")
    .update({ bot_enabled: false, updated_at: nowIso })
    .eq("id", params.conversationId);

  void appendHistoryEvent({
    leadId: params.leadId,
    conversationId: params.conversationId,
    eventType: "whatsapp_flow_blocked_max_attempts",
    title: "Fluxo WhatsApp encerrado por limite de tentativas",
    details: {
      stage: params.blockedStage,
      attempt: params.attempt,
      last_content: params.contentText || null,
    },
    actorType: "system",
  });

  await insertWhatsAppBotTextMessage({
    admin: params.admin,
    conversationId: params.conversationId,
    contentText: SUPPORT_FINAL_MESSAGE,
  });
  try {
    await sendAtendimentoWhatsAppText({
      phone: params.normalizedPhoneOnly,
      message: SUPPORT_FINAL_MESSAGE,
    });
  } catch (_e) {}
}

function looksLikeWhatsAppDirectLeadFirstMessage(value: string) {
  const clean = String(value ?? "").trim().toLowerCase();
  if (!clean) return false;
  if (/^\d+$/.test(clean) && clean.length >= 8) return false;
  return true;
}

async function insertWhatsAppBotTextMessage(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  conversationId: string;
  contentText: string;
  sentAt?: string;
}) {
  const sentAt = params.sentAt ?? new Date().toISOString();
  const { data, error } = await params.admin
    .from("atendimento_messages")
    .insert({
      conversation_id: params.conversationId,
      sender_role: "bot",
      content_text: params.contentText,
      media_type: "text",
      status: "entregue",
      sent_at: sentAt,
      delivered_at: sentAt,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    const code = String((error as any)?.code ?? "").trim();
    if (code !== "23505") {
      throw new Error(error.message || "Falha ao inserir mensagem automática do bot.");
    }
  }
  return (data as Record<string, unknown> | null) ?? null;
}

async function getLastBotMessage(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  conversationId: string;
}) {
  const { data } = await params.admin
    .from("atendimento_messages")
    .select("content_text, created_at")
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "bot")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { content_text: string | null; created_at: string | null } | null) ?? null;
}

async function getRecentBotMessages(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  conversationId: string;
  limit?: number;
}) {
  const limit = params.limit ?? 20;
  const { data } = await params.admin
    .from("atendimento_messages")
    .select("content_text, created_at, id")
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "bot")
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = Array.isArray(data) ? (data as Array<{ content_text: string | null; created_at: string | null; id?: string | null }>) : [];
  return rows.map((r) => String(r.content_text ?? "").trim()).filter(Boolean) as string[];
}

function inferExpectedWhatsAppFieldFromLastBot(lastBotText: string | null | undefined) {
  const raw = String(lastBotText ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith(LOCATION_STATE_INVALID_MESSAGE)) return "state" as const;
  if (raw.startsWith(LOCATION_CITY_INVALID_MESSAGE)) return "city" as const;
  if (
    raw === CAPTURED_FIELD_PROMPTS.state ||
    raw.includes("Em qual estado você mora?") ||
    raw.includes("informe o estado onde você mora") ||
    raw.includes("qual estado você mora")
  ) {
    return "state" as const;
  }
  if (
    raw === CAPTURED_FIELD_PROMPTS.city ||
    raw.includes("E a cidade?") ||
    raw.includes("qual a sua cidade") ||
    raw.includes("informe a cidade onde você mora")
  ) {
    return "city" as const;
  }
  if (
    raw.startsWith("Datas disponíveis") ||
    raw.startsWith("As datas disponíveis são:") ||
    raw.startsWith("Dias disponíveis") ||
    raw.startsWith("Os dias disponíveis são:") ||
    raw.includes("qual data você prefere") ||
    raw.includes("qual dia você prefere") ||
    raw.includes("escolha a melhor data") ||
    raw.includes("escolher o melhor dia") ||
    raw.startsWith("Responda apenas com o dia desejado")
  ) {
    return "date" as const;
  }
  if (raw.startsWith(EXPERIMENTAL_CLASS_DATE_INVALID_MESSAGE)) return "date" as const;
  if (
    raw.startsWith("Horários disponíveis") ||
    raw.startsWith("Os horários disponíveis são:") ||
    raw.includes("qual horário você prefere") ||
    raw.startsWith("Responda apenas com o horário desejado") ||
    raw.startsWith("Responda apenas com o horario desejado") ||
    raw.startsWith("Perfeito! E os horários disponíveis são:")
  ) {
    return "time" as const;
  }
  if (raw.startsWith(EXPERIMENTAL_CLASS_TIME_INVALID_MESSAGE)) return "time" as const;
  return null;
}

async function countWhatsAppLocationFailures(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
  field: "state" | "city";
}) {
  const eventType = params.field === "state" ? "state_validation_failed" : "city_validation_failed";
  const { count } = await params.admin
    .from("atendimento_history_events")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", params.leadId)
    .eq("conversation_id", params.conversationId)
    .eq("event_type", eventType);
  return Number(count ?? 0);
}

async function countWhatsAppScheduleFailures(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
  field: "date" | "time";
}) {
  const eventType =
    params.field === "date"
      ? "experimental_class_date_validation_failed"
      : "experimental_class_time_validation_failed";
  const { count } = await params.admin
    .from("atendimento_history_events")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", params.leadId)
    .eq("conversation_id", params.conversationId)
    .eq("event_type", eventType);
  return Number(count ?? 0);
}

async function detectExpectedWhatsAppFieldFromHistory(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
}): Promise<"state" | "city" | "date" | "time" | null> {
  const eventTypes = [
    "lead_timezone_collection_started",
    "state_collected",
    "city_prompt_presented",
    "city_collected",
    "lead_timezone_identified",
    "state_validation_failed",
    "city_validation_failed",
    "experimental_class_date_options_presented",
    "experimental_class_date_selected",
    "experimental_class_date_validation_failed",
    "experimental_class_time_options_presented",
    "experimental_class_time_validation_failed",
    "experimental_class_scheduled",
  ];
  const { data: events } = await params.admin
    .from("atendimento_history_events")
    .select("event_type, created_at")
    .eq("lead_id", params.leadId)
    .eq("conversation_id", params.conversationId)
    .in("event_type", eventTypes)
    .order("created_at", { ascending: false })
    .limit(20);
  if (!events || !events.length) return null;
  let blocked: "state" | "city" | "date" | "time" | null = null;
  let hasStateCollected = false;
  let hasCityCollected = false;
  for (const evt of events as Array<{ event_type: string; created_at: string }>) {
    const t = String(evt.event_type ?? "");
    switch (t) {
      case "experimental_class_scheduled":
        return null;
      case "experimental_class_time_validation_failed":
        blocked = "time";
        break;
      case "experimental_class_time_options_presented":
        return "time";
      case "experimental_class_date_validation_failed":
        blocked = "date";
        break;
      case "experimental_class_date_selected":
      case "experimental_class_date_options_presented":
        return "date";
      case "lead_timezone_identified":
      case "city_collected":
        hasCityCollected = true;
        if (!blocked) return null;
        break;
      case "city_validation_failed":
        blocked = "city";
        break;
      case "city_prompt_presented":
        if (!blocked) return "city";
        break;
      case "state_collected":
        hasStateCollected = true;
        if (!blocked && !hasCityCollected) return "city";
        break;
      case "state_validation_failed":
        blocked = "state";
        break;
      case "lead_timezone_collection_started":
        if (hasStateCollected && !blocked && !hasCityCollected) return "city";
        if (blocked) return blocked;
        return "state";
    }
  }
  return blocked;
}

function getWhatsAppNextMissingField(lead: any): "state" | "city" | null {
  const origin = String(lead?.origin ?? "").trim().toLowerCase();
  const isWhatsAppDirect = origin === "whatsapp_trafego_pago";
  const hasState = Boolean(String(lead?.state ?? "").trim());
  const hasCity = Boolean(String(lead?.city ?? "").trim());
  if (isWhatsAppDirect && !hasState) return "state";
  if (!hasCity) return "city";
  return null;
}

async function presentExperimentalClassDateOptionsWhatsApp(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
  leadTimeZone?: string | null;
}) {
  const now = new Date();
  const { data: bookedStartsRaw, error: bErr } = await params.admin
    .from("atendimento_experimental_class_bookings")
    .select("professor_start_at")
    .eq("status", "scheduled")
    .gte("professor_start_at", now.toISOString())
    .order("professor_start_at", { ascending: true });
  const bookedProfessorStarts = bErr
    ? []
    : (bookedStartsRaw ?? []).map((row: any) => String(row?.professor_start_at ?? "").trim()).filter(Boolean);
  const availability = listExperimentalClassAvailability({
    now,
    leadTimeZone: params.leadTimeZone,
    bookedProfessorStartAts: bookedProfessorStarts,
  });
  const messages = buildExperimentalClassDatesMessages(availability.dates);
  let lastOutbound: Record<string, unknown> | null = null;
  for (const message of messages) {
    lastOutbound = await insertWhatsAppBotTextMessage({
      admin: params.admin,
      conversationId: params.conversationId,
      contentText: message,
    });
  }
  await appendHistoryEvent({
    leadId: params.leadId,
    conversationId: params.conversationId,
    eventType: "experimental_class_date_options_presented",
    title: "Datas disponíveis da aula experimental apresentadas",
    details: {
      teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
      lead_timezone: String(params.leadTimeZone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
      options: availability.dates,
    },
    actorType: "system",
  });
  await syncConversationPreview({
    conversationId: params.conversationId,
    contentText: messages[messages.length - 1] ?? "",
    createdAt: new Date().toISOString(),
  });
  return { lastOutbound, availability, messages };
}

async function presentExperimentalClassTimeOptionsWhatsApp(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
  leadTimeZone?: string | null;
  professorDate: string;
}) {
  const now = new Date();
  const { data: bookedStartsRaw, error: bErr } = await params.admin
    .from("atendimento_experimental_class_bookings")
    .select("professor_start_at")
    .eq("status", "scheduled")
    .gte("professor_start_at", now.toISOString())
    .order("professor_start_at", { ascending: true });
  const bookedProfessorStarts = bErr
    ? []
    : (bookedStartsRaw ?? []).map((row: any) => String(row?.professor_start_at ?? "").trim()).filter(Boolean);
  const availability = listExperimentalClassAvailability({
    now,
    leadTimeZone: params.leadTimeZone,
    bookedProfessorStartAts: bookedProfessorStarts,
  });
  const dateOption = availability.dates.find((o) => o.professorDate === params.professorDate) ?? null;
  const slots = availability.slotsByProfessorDate.get(params.professorDate) ?? [];
  const messages = buildExperimentalClassTimesMessages({
    dayLabel: dateOption?.dayLabel ?? params.professorDate.slice(8, 10),
    options: slots,
  });
  let lastOutbound: Record<string, unknown> | null = null;
  for (const message of messages) {
    lastOutbound = await insertWhatsAppBotTextMessage({
      admin: params.admin,
      conversationId: params.conversationId,
      contentText: message,
    });
  }
  await appendHistoryEvent({
    leadId: params.leadId,
    conversationId: params.conversationId,
    eventType: "experimental_class_time_options_presented",
    title: "Horários disponíveis da aula experimental apresentados",
    details: {
      teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
      lead_timezone: String(params.leadTimeZone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
      professor_date: params.professorDate,
    },
    actorType: "system",
  });
  await syncConversationPreview({
    conversationId: params.conversationId,
    contentText: messages[messages.length - 1] ?? "",
    createdAt: new Date().toISOString(),
  });
  return { lastOutbound, dateOption, slots, messages };
}

async function getScheduledExperimentalClassBookingWhatsApp(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
}) {
  const { data } = await params.admin
    .from("atendimento_experimental_class_bookings")
    .select(
      "professor_start_at, id, status, attendance_status, student_start_notification_sent_at, attendant_start_notification_sent_at, attendance_checked_at",
    )
    .eq("lead_id", params.leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as any) ?? null;
}

async function analyzePayment(params: { text: string; mediaUrl?: string | null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false as const, error: "OPENAI_API_KEY não configurada" };
  }

  const openai = new OpenAI({ apiKey });
  const system = `Você analisa mensagens do WhatsApp (texto e/ou comprovante) e decide se isso é MUITO PROVAVELMENTE uma evidência de pagamento referente a uma cobrança.

Retorne sempre um JSON válido (sem texto fora do JSON) no formato:
{
  "is_payment_proof": boolean,
  "confidence": number,
  "reason": "string curta",
  "extracted": {
    "amount_brl": "string ou vazio",
    "payment_date": "string ou vazio",
    "payer_name": "string ou vazio",
    "reference": "string ou vazio"
  }
}

Regras:
- confidence deve ser entre 0 e 1
- Toda imagem ou documento enviado pelo cliente após uma cobrança deve ser tratado como potencial comprovante e pode gerar suspeita de pagamento mesmo sem texto.
- is_payment_proof só pode ser true quando confidence >= 0.75 e existir evidência clara de pagamento, seja:
  - comprovante/recibo/print (imagem) com sinais claros de transação, ou
  - confirmação textual explícita de que JÁ PAGOU (ex: "paguei", "pix feito", "transferi", "já está pago"), preferencialmente com algum detalhe (valor, data/hora, banco, id/transação, referência).
- Não marque como pagamento quando o texto indicar intenção futura ("vou pagar", "pagarei amanhã"), pedido de dados ("manda o pix"), ou dúvida ("posso pagar?").
`;

  const userText = params.text?.trim() ? params.text.trim() : "(sem texto)";

  const content = params.mediaUrl
    ? ([
        {
          type: "text",
          text: `Mensagem: ${userText}\n\nSe houver imagem ou documento anexado, trate como potencial comprovante de pagamento.`,
        },
        { type: "image_url", image_url: { url: params.mediaUrl } },
      ] as any)
    : (`Mensagem: ${userText}\n\nResponda apenas com o JSON.` as any);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const raw = completion.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);
  const isPayment = Boolean((parsed as any)?.is_payment_proof);
  const confidenceRaw = Number((parsed as any)?.confidence ?? 0);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;
  const reason = extractString((parsed as any)?.reason);
  return {
    ok: true as const,
    result: {
      is_payment_proof: isPayment,
      confidence,
      reason,
      extracted: (parsed as any)?.extracted ?? null,
      raw: parsed,
    },
  };
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: true, ignored: true });
  }

  const instanceId = getFirstNonEmpty(
    url.searchParams.get("instanceId"),
    url.searchParams.get("instance_id"),
    (body as any).instanceId,
    (body as any).instance_id,
    (body as any).instance,
    (body as any).id,
    (body as any).data?.instanceId,
    (body as any).data?.instance_id,
  );

  const eventType = getFirstNonEmpty(
    (body as any).type,
    (body as any).event,
    (body as any).eventType,
    (body as any).data?.type,
    (body as any).data?.event,
  );

  const senderRaw = getFirstNonEmpty(
    (body as any).sender,
    (body as any).message?.sender,
    (body as any).data?.sender,
    (body as any).data?.message?.sender,
  ).trim().toLowerCase();

  const statusRaw = getFirstNonEmpty(
    (body as any).status,
    (body as any).message?.status,
    (body as any).data?.status,
    (body as any).data?.message?.status,
  ).trim().toLowerCase();

  const rawFromMe =
    (body as any).fromMe === true ||
    (body as any).from_me === true ||
    (body as any).is_from_me === true ||
    (body as any).message?.fromMe === true ||
    (body as any).message?.from_me === true ||
    (body as any).message?.is_from_me === true ||
    (body as any).data?.fromMe === true ||
    (body as any).data?.from_me === true ||
    (body as any).data?.is_from_me === true ||
    (body as any).data?.message?.fromMe === true ||
    (body as any).data?.message?.from_me === true ||
    (body as any).data?.message?.is_from_me === true ||
    senderRaw === "me" ||
    /sent_by_me|sentbyme|notify_sent_by_me|notifysentbyme|sentByMe|notifySentByMe/i.test(
      String(eventType ?? "") + String((body as any)?.event ?? "") + String((body as any)?.eventType ?? ""),
    );

  const isOutboundOnlyEvent =
    /DeliveryCallback|MessageStatusCallback|notifySentByMe|notify_sent_by_me|sentByMe|sent_by_me/i.test(
      String(eventType ?? "") + String((body as any)?.event ?? ""),
    ) ||
    /sent|delivered|read|received_status|ack|message_status/i.test(statusRaw);

  const rawEventId = getFirstNonEmpty(
    (body as any).messageId,
    (body as any).message_id,
    (body as any).idMessage,
    (body as any).data?.messageId,
    (body as any).data?.message_id,
    (body as any).data?.idMessage,
  );

  const payloadString = JSON.stringify(body);
  const eventId = rawEventId || crypto.createHash("sha256").update(payloadString).digest("hex");

  const fromPhone = getFirstNonEmpty(
    (body as any).phone,
    (body as any).from,
    (body as any).sender?.phone,
    (body as any).senderPhone,
    (body as any).message?.from,
    (body as any).message?.phone,
    (body as any).data?.message?.from,
    (body as any).data?.message?.phone,
    (body as any).data?.phone,
    (body as any).data?.from,
    (body as any).data?.sender?.phone,
  );

  const messageText = getFirstNonEmpty(
    (body as any).text?.message,
    (body as any).text?.body,
    (body as any).message,
    (body as any).body,
    (body as any).message?.text,
    (body as any).message?.body,
    (body as any).data?.message?.text,
    (body as any).data?.message?.body,
    Array.isArray((body as any).messages) ? (body as any).messages?.[0]?.text : "",
    Array.isArray((body as any).messages) ? (body as any).messages?.[0]?.body : "",
    (body as any).data?.text?.message,
    (body as any).data?.message,
    (body as any).data?.body,
  );

  const mediaInfo = extractMediaInfo(body);
  const mediaUrl = mediaInfo.mediaUrl;

  if (!instanceId) {
    return Response.json({ ok: true, ignored: true, reason: "missing_instance_id" });
  }

  const admin = createSupabaseAdminClient();
  const instColsBase = ["user_id", "token"];
  const firstInst = await admin
    .from("whatsapp_instances")
    .select([...instColsBase, "client_token", "phone", "display_name"].join(", "))
    .eq("instance_id", instanceId)
    .maybeSingle();

  const missingClientTokenCol =
    firstInst.error &&
    /client_token/i.test(firstInst.error.message) &&
    /column/i.test(firstInst.error.message);
  const missingPhoneCol =
    firstInst.error &&
    /\bphone\b/i.test(firstInst.error.message) &&
    /column/i.test(firstInst.error.message);
  const missingDisplayNameCol =
    firstInst.error &&
    /display_name/i.test(firstInst.error.message) &&
    /column/i.test(firstInst.error.message);

  let instance: any = firstInst.data;
  let instErr = firstInst.error;

  if (firstInst.error && (missingClientTokenCol || missingPhoneCol || missingDisplayNameCol)) {
    const retryCols = [...instColsBase];
    if (!missingClientTokenCol) retryCols.push("client_token");
    if (!missingPhoneCol) retryCols.push("phone");
    if (!missingDisplayNameCol) retryCols.push("display_name");
    const retryInst = await admin
      .from("whatsapp_instances")
      .select(retryCols.join(", "))
      .eq("instance_id", instanceId)
      .maybeSingle();
    instance = retryInst.data;
    instErr = retryInst.error;
  }

  if (instErr) {
    return Response.json({ ok: false, error: instErr.message }, { status: 500 });
  }

  const userId = instance?.user_id ? String(instance.user_id) : "";
  if (!userId) {
    return Response.json({ ok: true, ignored: true, reason: "unknown_instance" });
  }

  if (!missingPhoneCol) {
    const currentPhoneRaw = String(instance?.phone ?? "").trim();
    if (!currentPhoneRaw && instance?.token) {
      try {
        const token = String(instance.token ?? "");
        const clientToken = missingClientTokenCol ? null : instance?.client_token ?? null;
        const meData = await getZapiInstanceMeta({
          instance_id: instanceId,
          token,
          client_token: clientToken || undefined,
        });
        if (meData) {
          const candidates: string[] = [];
          if (typeof meData.phone === "string") candidates.push(meData.phone);
          if (typeof meData.telephone === "string") candidates.push(meData.telephone);
          if (meData.whatsapp && typeof meData.whatsapp.phone === "string") candidates.push(meData.whatsapp.phone);
          if (meData.me && typeof meData.me.phone === "string") candidates.push(meData.me.phone);
          if (typeof meData.id === "string") candidates.push(meData.id);
          const picked = candidates.find((c) => c && /\d/.test(c));
          if (picked) {
            const digitsOnly = picked.replace(/\D/g, "");
            if (digitsOnly.length >= 10) {
              await admin
                .from("whatsapp_instances")
                .update({ phone: digitsOnly })
                .eq("instance_id", instanceId);
              if (instance) instance.phone = digitsOnly;
            }
          }
        }
      } catch (_metaErr) {
        // Falha ao consultar /me da Z-API nao deve quebrar o processamento do evento
      }
    }
  }

  const pendingPhoneValidationRef: { id: string } = { id: "" };
  const normalizedEventType = String(eventType ?? "").trim();
  const nextInstanceStatus =
    normalizedEventType === "DisconnectedCallback"
      ? "disconnected"
      : normalizedEventType === "ReceivedCallback" ||
          normalizedEventType === "MessageStatusCallback" ||
          normalizedEventType === "DeliveryCallback"
        ? "connected"
        : null;

  if (nextInstanceStatus) {
    await admin
      .from("whatsapp_instances")
      .update({ status: nextInstanceStatus })
      .eq("instance_id", instanceId);
  }

  const isMessageFromConnectedNumber =
    rawFromMe === true &&
    normalizedEventType !== "DeliveryCallback" &&
    normalizedEventType !== "MessageStatusCallback" &&
    normalizedEventType !== "DisconnectedCallback";

  if (isMessageFromConnectedNumber) {
    return Response.json({
      ok: true,
      ignored: true,
      reason: "message_from_connected_number",
    });
  }

  if (isOutboundOnlyEvent) {
    return Response.json({
      ok: true,
      ignored: true,
      reason: "outbound_only_status_event_no_inbound_reply_required",
    });
  }

  if (rawFromMe === true) {
    return Response.json({
      ok: true,
      ignored: true,
      reason: "broad_from_me_outbound_message_or_status",
    });
  }

  {
    const { error: insertErr } = await admin
      .from("whatsapp_events")
      .insert({
        user_id: userId,
        provider: "zapi",
        event_id: eventId,
        instance_id: instanceId,
        event_type: eventType || null,
        payload: body,
      });
    if (insertErr) {
      const code = String((insertErr as any)?.code ?? "").trim();
      if (code === "23505") {
        return Response.json({ ok: true, ignored: true, reason: "duplicate_event_already_processed" });
      }
      return Response.json({ ok: false, error: insertErr.message }, { status: 500 });
    }
  }

  const callbackMessageIds = Array.from(
    new Set(
      [
        rawEventId,
        ...(Array.isArray((body as any).ids)
          ? (body as any).ids.map((value: unknown) => String(value ?? "").trim())
          : []),
      ].filter(Boolean),
    ),
  );
  if ((eventType === "DeliveryCallback" || eventType === "MessageStatusCallback") && callbackMessageIds.length > 0) {
    const pendingEvent = await findPendingPhoneValidationEvent({
      admin,
      messageIds: callbackMessageIds,
    });

    pendingPhoneValidationRef.id = String((pendingEvent as any)?.id ?? "");
    if (!pendingEvent?.id) {
      return Response.json({ ok: true, ignored: true, reason: "no_pending_phone_validation" });
    }

    const pendingDetails = ((pendingEvent as any).details ?? {}) as Record<string, unknown>;
    const pendingPhone = String(pendingDetails.phone ?? "").trim();
    const deliveryError = getFirstNonEmpty((body as any).error, (body as any).data?.error);
    const statusChange = normalizeText(
      getFirstNonEmpty((body as any).status, (body as any).data?.status),
    ).toUpperCase();
    const nowIso = new Date().toISOString();

    if (eventType === "DeliveryCallback" && deliveryError) {
      const isRealInvalidWhatsApp = isExplicitInvalidWhatsAppError(deliveryError);
      const { data: claimedFailureEvent } = await admin
        .from("atendimento_history_events")
        .update({
          event_type: isRealInvalidWhatsApp ? "phone_validation_failed" : "phone_validation_timeout",
          title: isRealInvalidWhatsApp
            ? "WhatsApp informado não passou no teste"
            : "Validacao do WhatsApp falhou por indisponibilidade tecnica",
          details: {
            ...pendingDetails,
            final_status: isRealInvalidWhatsApp ? "DELIVERY_ERROR" : "DELIVERY_TECHNICAL_ERROR",
            error: deliveryError,
            failed_at: nowIso,
          },
        })
        .eq("id", String((pendingEvent as any).id))
        .eq("event_type", "phone_validation_pending")
        .select("id")
        .maybeSingle();

      if (!claimedFailureEvent?.id) {
        return Response.json({ ok: true, ignored: true, reason: "phone_validation_already_processed" });
      }

      const { data: leadRow } = await admin
        .from("atendimento_leads")
        .select("id, unread_count, status, funnel_stage")
        .eq("id", String((pendingEvent as any).lead_id ?? ""))
        .maybeSingle();

      if (!isRealInvalidWhatsApp) {
        const { data: technicalMessage } = await admin
          .from("atendimento_messages")
          .insert({
            conversation_id: String((pendingEvent as any).conversation_id ?? ""),
            sender_role: "bot",
            content_text: WHATSAPP_TECHNICAL_TIMEOUT_MESSAGE,
            media_type: "text",
            status: "entregue",
            sent_at: nowIso,
            delivered_at: nowIso,
          })
          .select("id, content_text")
          .maybeSingle();

        await admin
          .from("atendimento_leads")
          .update({
            status: (leadRow as any)?.status ?? null,
            funnel_stage: (leadRow as any)?.funnel_stage ?? null,
            last_interaction_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", String((pendingEvent as any).lead_id ?? ""));

        await syncConversationPreview({
          conversationId: String((pendingEvent as any).conversation_id ?? ""),
          contentText: String((technicalMessage as any)?.content_text ?? WHATSAPP_TECHNICAL_TIMEOUT_MESSAGE),
          createdAt: nowIso,
        });

        return Response.json({ ok: true, validated: false, reason: "delivery_error_technical" });
      }

      const failureAttempts = await getPhoneValidationFailureCount({
        admin,
        leadId: String((pendingEvent as any).lead_id ?? ""),
        conversationId: String((pendingEvent as any).conversation_id ?? ""),
      });
      const shouldBlockConversation = failureAttempts >= MAX_PHONE_VALIDATION_ATTEMPTS;

      const { data: failureMessage } = await admin
        .from("atendimento_messages")
        .insert({
          conversation_id: String((pendingEvent as any).conversation_id ?? ""),
          sender_role: "bot",
          content_text: shouldBlockConversation
            ? WHATSAPP_INVALID_FINAL_MESSAGE
            : buildPhoneValidationRetryMessage(failureAttempts),
          media_type: "text",
          status: "entregue",
          sent_at: nowIso,
          delivered_at: nowIso,
        })
        .select("id, content_text")
        .maybeSingle();

      await admin
        .from("atendimento_leads")
        .update({
          status: shouldBlockConversation ? "encerrado" : (leadRow as any)?.status ?? null,
          funnel_stage: shouldBlockConversation ? "encerrado" : (leadRow as any)?.funnel_stage ?? null,
          last_interaction_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", String((pendingEvent as any).lead_id ?? ""));

      if (shouldBlockConversation) {
        await admin
          .from("atendimento_conversations")
          .update({
            bot_enabled: false,
            updated_at: nowIso,
          })
          .eq("id", String((pendingEvent as any).conversation_id ?? ""));

        await admin.from("atendimento_history_events").insert({
          lead_id: String((pendingEvent as any).lead_id ?? ""),
          conversation_id: String((pendingEvent as any).conversation_id ?? ""),
          event_type: "conversation_closed",
          title: "Atendimento encerrado após 3 tentativas inválidas de WhatsApp",
          details: {
            invalid_attempts: failureAttempts,
            source: "delivery_callback",
          },
          actor_type: "system",
          actor_email: null,
        });
      }

      await syncConversationPreview({
        conversationId: String((pendingEvent as any).conversation_id ?? ""),
        contentText: String((failureMessage as any)?.content_text ?? ""),
        createdAt: nowIso,
      });

      return Response.json({ ok: true, validated: false, reason: "delivery_error" });
    }

    const shouldConfirmPhoneValidation =
      (eventType === "DeliveryCallback" && !deliveryError) ||
      (eventType === "MessageStatusCallback" &&
        (statusChange === "SENT" || statusChange === "RECEIVED" || statusChange === "READ"));

    if (!shouldConfirmPhoneValidation) {
      return Response.json({ ok: true, ignored: true, reason: "awaiting_final_phone_status" });
    }

    const { data: claimedSuccessEvent } = await admin
      .from("atendimento_history_events")
      .update({
        event_type: "phone_validated",
        title: "WhatsApp validado e salvo",
        details: {
          ...pendingDetails,
          final_status: statusChange || eventType,
          confirmed_at: nowIso,
        },
      })
      .eq("id", String((pendingEvent as any).id))
      .eq("event_type", "phone_validation_pending")
      .select("id")
      .maybeSingle();

    if (!claimedSuccessEvent?.id) {
      return Response.json({ ok: true, ignored: true, reason: "phone_validation_already_processed" });
    }

    const { data: leadRecord } = await admin
      .from("atendimento_leads")
      .select("*")
      .eq("id", String((pendingEvent as any).lead_id ?? ""))
      .maybeSingle();

    if (!leadRecord?.id || !pendingPhone) {
      return Response.json({ ok: true, ignored: true, reason: "missing_pending_lead_or_phone" });
    }

    const resolvedLeadLocation = String((leadRecord as any)?.city ?? "").trim()
      ? resolveTimeZoneFromCityInput({
          city: String((leadRecord as any)?.city ?? ""),
          state: String((leadRecord as any)?.state ?? ""),
          phone: pendingPhone,
        })
      : null;

    const nextLead = {
      ...(leadRecord as any),
      phone: pendingPhone,
      timezone: resolvedLeadLocation?.timeZone ?? (String((leadRecord as any)?.timezone ?? "").trim() || null),
      country:
        resolvedLeadLocation?.country === "BR"
          ? "Brasil"
          : resolvedLeadLocation?.country === "US"
            ? "Estados Unidos"
            : String((leadRecord as any)?.country ?? "").trim() || null,
    };
    const botResponse = botReplyForLead({
      lead: nextLead,
      messageText: "",
    });
    const successMessage = WHATSAPP_REGISTERED_SUCCESS_MESSAGE;
    const nextStatus = botResponse.status;
    const nextStage = botResponse.stage;

    await admin
      .from("atendimento_leads")
      .update({
        phone: pendingPhone,
        ...(resolvedLeadLocation
          ? {
              state: resolvedLeadLocation.state,
              city: resolvedLeadLocation.city,
              timezone: resolvedLeadLocation.timeZone,
              country: resolvedLeadLocation.country === "BR" ? "Brasil" : "Estados Unidos",
            }
          : {}),
        status: nextStatus,
        funnel_stage: nextStage,
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", String((pendingEvent as any).lead_id ?? ""));

    await upsertCapturedPhoneField({
      leadId: String((pendingEvent as any).lead_id ?? ""),
      sourceMessageId: callbackMessageIds[0] ?? String((pendingEvent as any).id ?? ""),
      phone: pendingPhone,
    });

    if (resolvedLeadLocation) {
      await appendHistoryEvent({
        leadId: String((pendingEvent as any).lead_id ?? ""),
        conversationId: String((pendingEvent as any).conversation_id ?? ""),
        eventType: "lead_timezone_identified",
        title: "Cidade e fuso do lead identificados automaticamente",
        details: {
          state: resolvedLeadLocation.state,
          city: resolvedLeadLocation.city,
          timezone: resolvedLeadLocation.timeZone,
          teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
          country: resolvedLeadLocation.country === "BR" ? "Brasil" : "Estados Unidos",
          source: resolvedLeadLocation.source,
        },
        actorType: "system",
      });
    }

    const outgoingMessages = [successMessage];
    const followUpMessage = String(botResponse.message ?? "").trim();
    if (followUpMessage && followUpMessage !== successMessage) {
      if (followUpMessage === EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE) {
        outgoingMessages.push(
          ...buildExperimentalClassDatePromptMessages(String((nextLead as any)?.full_name ?? "").trim()),
        );
      } else {
        outgoingMessages.push(followUpMessage);
      }
    }

    let previewText = successMessage;
    for (const message of outgoingMessages) {
      const { data: outbound } = await admin
        .from("atendimento_messages")
        .insert({
          conversation_id: String((pendingEvent as any).conversation_id ?? ""),
          sender_role: "bot",
          content_text: message,
          media_type: "text",
          status: "entregue",
          sent_at: nowIso,
          delivered_at: nowIso,
        })
        .select("content_text")
        .maybeSingle();

      previewText = String((outbound as any)?.content_text ?? message);
    }

    if (followUpMessage === EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE) {
      const bookedProfessorStarts = await listScheduledExperimentalClassProfessorStarts({
        admin,
        nowIso,
      });
      const availability = listExperimentalClassAvailability({
        leadTimeZone: String((nextLead as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
        bookedProfessorStartAts: bookedProfessorStarts,
      });
      const availabilityMessages = buildExperimentalClassDatesMessages(availability.dates);

      for (const availabilityMessage of availabilityMessages) {
        const { data: availabilityOutbound } = await admin
          .from("atendimento_messages")
          .insert({
            conversation_id: String((pendingEvent as any).conversation_id ?? ""),
            sender_role: "bot",
            content_text: availabilityMessage,
            media_type: "text",
            status: "entregue",
            sent_at: nowIso,
            delivered_at: nowIso,
          })
          .select("content_text")
          .maybeSingle();

        previewText = String((availabilityOutbound as any)?.content_text ?? availabilityMessage);
      }

      await appendHistoryEvent({
        leadId: String((pendingEvent as any).lead_id ?? ""),
        conversationId: String((pendingEvent as any).conversation_id ?? ""),
        eventType: "experimental_class_date_options_presented",
        title: "Datas disponíveis da aula experimental apresentadas",
        details: {
          teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
          lead_timezone: String((nextLead as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
          options: availability.dates,
        },
        actorType: "system",
      });
    }

    if (
      followUpMessage === CAPTURED_FIELD_PROMPTS.state ||
      followUpMessage === CAPTURED_FIELD_PROMPTS.city
    ) {
      await appendHistoryEvent({
        leadId: String((pendingEvent as any).lead_id ?? ""),
        conversationId: String((pendingEvent as any).conversation_id ?? ""),
        eventType: "lead_timezone_collection_started",
        title: "Coleta de estado e cidade do lead iniciada após validação do WhatsApp",
        details: {
          teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
        },
        actorType: "system",
      });
    }

    await syncConversationPreview({
      conversationId: String((pendingEvent as any).conversation_id ?? ""),
      contentText: previewText,
      createdAt: nowIso,
    });

    await appendHistoryEvent({
      leadId: String((pendingEvent as any).lead_id ?? ""),
      conversationId: String((pendingEvent as any).conversation_id ?? ""),
      eventType: "stage_changed",
      title: "Etapa do funil atualizada automaticamente",
      details: { status: nextStatus, funnel_stage: nextStage },
      actorType: "bot",
    });

    return Response.json({ ok: true, validated: true, reason: "message_received" });
  }

  const hasContent = Boolean((messageText || "").trim() || mediaInfo.hasPaymentMedia);
  if (!hasContent) {
    await admin.from("logs").insert({
      user_id: userId,
      tipo: "zapi_webhook_recebido",
      descricao: `Webhook recebido (sem conteúdo): instance=${instanceId} type=${eventType || "-"}`,
    });
    return Response.json({ ok: true, ignored: true });
  }

  await admin.from("logs").insert({
    user_id: userId,
    tipo: "zapi_webhook_recebido",
    descricao: `Webhook recebido: instance=${instanceId} type=${eventType || "-"} from=${normalizePhone(fromPhone) || "-"}`,
  });

  const normalizedFrom = normalizePhone(fromPhone);
  const validatedFrom = normalizeAndValidateFromPhone(fromPhone);
  const normalizedPhoneOnly = validatedFrom.digitsOnly;
  const isRealInboundMessage =
    normalizedEventType === "ReceivedCallback" ||
    normalizedEventType === "MESSAGE_RECEIVED" ||
    normalizedEventType === "message_received" ||
    normalizedEventType === "message" ||
    normalizedEventType === "inbound" ||
    (normalizedFrom !== "receivedcallback" && (Boolean(messageText?.trim()) || Boolean(mediaUrl?.trim())));

  if (normalizedFrom && !validatedFrom.valid) {
    return Response.json({
      ok: true,
      ignored: true,
      reason: "invalid_or_non_user_phone_not_processed",
      invalidReason: validatedFrom.invalidReason,
      phoneSample: validatedFrom.digitsOnly.slice(0, 8) || "-",
      phoneLength: validatedFrom.digitsOnly.length,
    });
  }

  if (normalizedPhoneOnly && !isRealInboundMessage && !pendingPhoneValidationRef.id) {
    return Response.json({
      ok: true,
      ignored: true,
      reason: "non_inbound_event_skipped",
      eventType: normalizedEventType || "unknown",
    });
  }

  if (normalizedFrom) {
    try {
      const leadContext = await ensureWhatsAppLeadAndConversation({
        phone: normalizedPhoneOnly,
        userId,
        firstNameFromMessage: null,
        initialState: null,
        initialTimezone: null,
        initialCountry: null,
      });
      if (leadContext?.lead?.id && leadContext?.conversation?.id) {
        const nowIso = new Date().toISOString();
        const leadId = String(leadContext.lead.id);
        const conversationId = String(leadContext.conversation.id);
        const lead = leadContext.lead as any;
        const conversation = leadContext.conversation as any;

        const currentBooking = await getScheduledExperimentalClassBookingWhatsApp({ admin, leadId });
        const currentBookingId = currentBooking?.id ? String(currentBooking.id) : "";
        const funnelStageRaw = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
        const leadStatusRaw = String((lead as any)?.status ?? "").trim().toLowerCase();
        const isLeadRepescagemStatus =
          funnelStageRaw === "repescagem" || leadStatusRaw === "repescagem";

        let postAttendanceHistoryConfirmedAttendedEvent = false;
        let postAttendanceHistoryConfirmedNoShowEvent = false;
        let postAttendanceHistoryMatriculaRecusadaEvent = false;
        try {
          const { data: histAttAll } = await admin
            .from("atendimento_history_events")
            .select("event_type")
            .eq("lead_id", leadId)
            .eq("conversation_id", conversationId)
            .in("event_type", [
              "experimental_class_attendance_confirmed",
              "experimental_class_attendance_follow_up_required",
              "experimental_class_attendance_attended",
              "experimental_class_attendance_no_show",
              "matricula_pendente_resposta_nao_nuclear",
              "whatsapp_matricula_recusada_fixed_reply",
            ])
            .limit(6);
          const histAttEvents = Array.isArray((histAttAll as any)?.data ?? [])
            ? ((histAttAll as any).data as Array<{ event_type: string }>)
            : [];
          postAttendanceHistoryConfirmedAttendedEvent = histAttEvents.some(
            (e) =>
              e.event_type === "experimental_class_attendance_confirmed" ||
              e.event_type === "experimental_class_attendance_attended",
          );
          postAttendanceHistoryConfirmedNoShowEvent = histAttEvents.some(
            (e) =>
              e.event_type === "experimental_class_attendance_follow_up_required" ||
              e.event_type === "experimental_class_attendance_no_show",
          );
          postAttendanceHistoryMatriculaRecusadaEvent = histAttEvents.some(
            (e) =>
              e.event_type === "matricula_pendente_resposta_nao_nuclear" ||
              e.event_type === "whatsapp_matricula_recusada_fixed_reply",
          );
        } catch (_e) {}

        let lastBotTextNuclear: string | null = null;
        let recentBotTextsNuclear: string[] = [];
        try {
          recentBotTextsNuclear = await getRecentBotMessages({
            admin,
            conversationId,
            limit: 20,
          });
          const lastBotMsgNuclearSingle = await getLastBotMessage({ admin, conversationId });
          lastBotTextNuclear = String(lastBotMsgNuclearSingle?.content_text ?? "").trim() || null;
        } catch (_e) {
          lastBotTextNuclear = null;
          recentBotTextsNuclear = [];
        }
        const RESPOSTA_REPESCAGEM_FIXA = "Em breve nossa equipe entrará em contato.";
        const MSG_SIM_NAO_INVALIDA = "Responda com sim ou não.";
        const NAO_RECUSA_MSG_1 = "Tudo bem, entendemos que talvez ainda não seja o momento.";

        const inboundContentRaw = String(messageText ?? "").trim();
        const inboundNormalizedNuclear = inboundContentRaw
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .replace(/[.!?,\s]+$/g, "")
          .toLowerCase();
        const isYesNuclear =
          inboundNormalizedNuclear === "sim" ||
          inboundNormalizedNuclear === "s" ||
          /^sim\b/i.test(inboundNormalizedNuclear) ||
          inboundNormalizedNuclear.replace(/\s+/g, "") === "sim";
        const isNoNuclear =
          inboundNormalizedNuclear === "nao" ||
          inboundNormalizedNuclear === "n" ||
          /^nao\b/i.test(inboundNormalizedNuclear) ||
          inboundNormalizedNuclear.replace(/\s+/g, "") === "nao" ||
          /^n[aãâ]o\b/i.test(inboundContentRaw.trim());

        const recentBotHasMsgSimNao = recentBotTextsNuclear.some((text) => text === MSG_SIM_NAO_INVALIDA);
        const ultimaMsgBotPedeSimNao =
          lastBotTextNuclear === MSG_SIM_NAO_INVALIDA || recentBotHasMsgSimNao;
        const bookingAttendanceAttendedByCol =
          String(currentBooking?.attendance_status ?? "").trim().toLowerCase() === "attended";
        const bookingAttendanceNoShowByCol =
          String(currentBooking?.attendance_status ?? "").trim().toLowerCase() === "no_show";
        const leadEstaEmMatriculaPendentePosAttendance =
          (funnelStageRaw === "matricula_pendente" || leadStatusRaw === "matricula_pendente") &&
          (postAttendanceHistoryConfirmedAttendedEvent ||
            Boolean(currentBookingId) ||
            bookingAttendanceAttendedByCol) &&
          !postAttendanceHistoryMatriculaRecusadaEvent;
        const leadEstaEmMatriculaRecusadaPosAttendance =
          postAttendanceHistoryMatriculaRecusadaEvent ||
          ((funnelStageRaw === "matricula_pendente_recusada" ||
            leadStatusRaw === "matricula_pendente_recusada") &&
            (postAttendanceHistoryConfirmedAttendedEvent ||
              Boolean(currentBookingId) ||
              bookingAttendanceAttendedByCol));
        const leadEstaEmRepescagemNoShow =
          (isLeadRepescagemStatus && postAttendanceHistoryConfirmedNoShowEvent) ||
          (isLeadRepescagemStatus && bookingAttendanceNoShowByCol) ||
          (postAttendanceHistoryConfirmedNoShowEvent && (funnelStageRaw === "repescagem" || leadStatusRaw === "repescagem"));
        const leadDirectlyInPosAttendanceStepNuclear =
          (funnelStageRaw === "matricula_pendente" &&
            (postAttendanceHistoryConfirmedAttendedEvent ||
              bookingAttendanceAttendedByCol ||
              Boolean(currentBookingId))) ||
          (funnelStageRaw === "matricula_pendente_recusada" &&
            (postAttendanceHistoryConfirmedAttendedEvent ||
              bookingAttendanceAttendedByCol ||
              Boolean(currentBookingId))) ||
          (leadStatusRaw === "matricula_pendente" &&
            (postAttendanceHistoryConfirmedAttendedEvent ||
              bookingAttendanceAttendedByCol ||
              Boolean(currentBookingId))) ||
          (leadStatusRaw === "matricula_pendente_recusada" &&
            (postAttendanceHistoryConfirmedAttendedEvent ||
              bookingAttendanceAttendedByCol ||
              Boolean(currentBookingId)));
        const entrouNoFluxoPosAttendancePorForcaBruta =
          ultimaMsgBotPedeSimNao &&
          (isYesNuclear || isNoNuclear) &&
          (funnelStageRaw === "matricula_pendente" ||
            leadStatusRaw === "matricula_pendente" ||
            funnelStageRaw === "matricula_pendente_recusada" ||
            leadStatusRaw === "matricula_pendente_recusada");

        if (
          postAttendanceHistoryMatriculaRecusadaEvent ||
          leadEstaEmMatriculaRecusadaPosAttendance ||
          leadEstaEmRepescagemNoShow ||
          entrouNoFluxoPosAttendancePorForcaBruta ||
          leadDirectlyInPosAttendanceStepNuclear ||
          (ultimaMsgBotPedeSimNao &&
            (leadEstaEmMatriculaPendentePosAttendance ||
              postAttendanceHistoryConfirmedAttendedEvent ||
              (Boolean(currentBookingId) &&
                (bookingAttendanceAttendedByCol ||
                  String((currentBooking as any)?.status ?? "").trim().toLowerCase() === "completed"))))
        ) {
          const inboundMediaType = mediaInfo.hasPaymentMedia
            ? mediaInfo.mediaUrl
              ? "document"
              : "text"
            : "text";
          const inboundMediaUrl = mediaInfo.mediaUrl || null;
          try {
            await admin.from("atendimento_messages").insert({
              conversation_id: conversationId,
              sender_role: "lead",
              content_text: inboundContentRaw || null,
              media_type: inboundMediaType,
              media_url: inboundMediaUrl,
              status: "recebida",
              sent_at: nowIso,
              delivered_at: nowIso,
            });
          } catch (_e) {}
          try {
            void admin
              .from("atendimento_leads")
              .update({
                unread_count: Number(lead.unread_count ?? 0) + 1,
                is_new_for_attendant: true,
                last_interaction_at: nowIso,
                updated_at: nowIso,
              })
              .eq("id", leadId);
          } catch (_e) {}

          if (leadEstaEmMatriculaRecusadaPosAttendance) {
            return Response.json({
              ok: true,
              ignored: true,
              reason: "nuclear_post_attendance_matricula_recusada_ignored_quiet",
              flow: "nuclear_post_attendance_matricula_recusada_ignored",
            });
          }

          if (leadEstaEmRepescagemNoShow) {
            return Response.json({
              ok: true,
              ignored: true,
              reason: "nuclear_post_attendance_repescagem_no_show_ignored_quiet",
              flow: "nuclear_post_attendance_repescagem_no_show_ignored",
            });
          }

          if (isNoNuclear) {
            try {
              const leadUpdatePatch: Record<string, unknown> = { updated_at: nowIso };
              const funnelPatch: Record<string, unknown> = {
                funnel_stage: "matricula_pendente_recusada",
                status: "matricula_pendente_recusada",
                ...leadUpdatePatch,
              };
              let patchAppliedOk = false;
              try {
                const { error: fullErr } = await admin
                  .from("atendimento_leads")
                  .update(funnelPatch)
                  .eq("id", leadId);
                if (!fullErr) patchAppliedOk = true;
              } catch (_e) {}
              if (!patchAppliedOk) {
                try {
                  const { error: partialErr } = await admin
                    .from("atendimento_leads")
                    .update(leadUpdatePatch)
                    .eq("id", leadId);
                  void partialErr;
                } catch (_e) {}
              }
            } catch (_e) {}
            const replies = [
              NAO_RECUSA_MSG_1,
              RESPOSTA_REPESCAGEM_FIXA,
            ];
            for (const txt of replies) {
              try {
                await insertWhatsAppBotTextMessage({
                  admin,
                  conversationId,
                  contentText: txt,
                });
              } catch (_e) {}
              try {
                await sendAtendimentoWhatsAppText({
                  phone: normalizedPhoneOnly,
                  message: txt,
                });
              } catch (_e) {}
            }
            try {
              void appendHistoryEvent({
                leadId,
                conversationId,
                eventType: "matricula_pendente_resposta_nao_nuclear",
                title: "Matricula pendente pos-attendance (nuclear): lead respondeu NAO",
                details: {
                  inbound_text: inboundContentRaw,
                  reply_messages: replies,
                  source: "whatsapp_zapi_nuclear",
                },
                actorType: "bot",
              });
            } catch (_e) {}
            try {
              await admin
                .from("atendimento_conversations")
                .update({ bot_enabled: true, updated_at: nowIso })
                .eq("id", conversationId);
            } catch (_e) {}
            return Response.json({
              ok: true,
              handled: true,
              flow: "nuclear_post_attendance_matricula_pendente_resposta_nao",
            });
          } else if (isYesNuclear) {
            try {
              await admin
                .from("atendimento_leads")
                .update({
                  funnel_stage: "matricula_confirmada",
                  status: "matricula_confirmada",
                  updated_at: nowIso,
                })
                .eq("id", leadId);
            } catch (_e) {}
            const replySim =
              "Perfeito! Em breve nossa equipe entrará em contato para finalizar sua matrícula.";
            try {
              await insertWhatsAppBotTextMessage({
                admin,
                conversationId,
                contentText: replySim,
              });
            } catch (_e) {}
            try {
              await sendAtendimentoWhatsAppText({
                phone: normalizedPhoneOnly,
                message: replySim,
              });
            } catch (_e) {}
            try {
              void appendHistoryEvent({
                leadId,
                conversationId,
                eventType: "matricula_pendente_resposta_sim_nuclear",
                title: "Matricula pendente pos-attendance (nuclear): lead respondeu SIM",
                details: {
                  inbound_text: inboundContentRaw,
                  reply_message: replySim,
                  source: "whatsapp_zapi_nuclear",
                },
                actorType: "bot",
              });
            } catch (_e) {}
            try {
              await admin
                .from("atendimento_conversations")
                .update({ bot_enabled: true, updated_at: nowIso })
                .eq("id", conversationId);
            } catch (_e) {}
            return Response.json({
              ok: true,
              handled: true,
              flow: "nuclear_post_attendance_matricula_pendente_resposta_sim",
            });
          } else {
            try {
              await insertWhatsAppBotTextMessage({
                admin,
                conversationId,
                contentText: MSG_SIM_NAO_INVALIDA,
              });
            } catch (_e) {}
            try {
              await sendAtendimentoWhatsAppText({
                phone: normalizedPhoneOnly,
                message: MSG_SIM_NAO_INVALIDA,
              });
            } catch (_e) {}
            return Response.json({
              ok: true,
              handled: true,
              flow: "nuclear_post_attendance_matricula_pendente_invalida",
            });
          }
        }

        if (leadEstaEmMatriculaRecusadaPosAttendance) {
          return Response.json({
            ok: true,
            ignored: true,
            reason: "fallback_matricula_recusada_ignored_quiet",
            flow: "whatsapp_matricula_recusada_ignored",
          });
        }

        if (leadEstaEmRepescagemNoShow) {
          return Response.json({
            ok: true,
            ignored: true,
            reason: "fallback_repescagem_no_show_ignored_quiet",
            flow: "whatsapp_repescagem_no_show_ignored",
          });
        }

        const handledByPosAttendanceFlowNuclear =
          leadEstaEmMatriculaPendentePosAttendance ||
          leadEstaEmMatriculaRecusadaPosAttendance ||
          leadEstaEmRepescagemNoShow;

        const hasStudentNotificationCol = Boolean(currentBooking?.student_start_notification_sent_at);
        const hasAttendantNotificationCol = Boolean(currentBooking?.attendant_start_notification_sent_at);
        let hasAnyBookingNotificationSentByHistory = false;
        if (currentBookingId && !(hasStudentNotificationCol || hasAttendantNotificationCol)) {
          try {
            const { data: hist } = await admin
              .from("atendimento_history_events")
              .select("event_type")
              .eq("lead_id", leadId)
              .eq("conversation_id", conversationId)
              .in("event_type", [
                "experimental_class_student_start_notification_sent",
                "experimental_class_attendant_start_notification_sent",
              ])
              .limit(2);
            hasAnyBookingNotificationSentByHistory = Array.isArray(hist) && hist.length > 0;
          } catch (_e) {}
        }
        const hasAttendanceStatusCol =
          String(currentBooking?.attendance_status ?? "").trim() === "attended" ||
          String(currentBooking?.attendance_status ?? "").trim() === "no_show" ||
          Boolean(currentBooking?.attendance_checked_at);
        let hasAnyAttendanceResolvedByHistory = false;
        if (currentBookingId && !hasAttendanceStatusCol) {
          try {
            const { data: histAtt } = await admin
              .from("atendimento_history_events")
              .select("event_type")
              .eq("lead_id", leadId)
              .eq("conversation_id", conversationId)
              .in("event_type", [
                "experimental_class_attendance_attended",
                "experimental_class_attendance_no_show",
                "experimental_class_attendance_follow_up_required",
              ])
              .limit(2);
            hasAnyAttendanceResolvedByHistory = Array.isArray(histAtt) && histAtt.length > 0;
          } catch (_e) {}
        }
        const anyNotificationSent =
          hasStudentNotificationCol || hasAttendantNotificationCol || hasAnyBookingNotificationSentByHistory;
        const anyAttendanceResolved = hasAttendanceStatusCol || hasAnyAttendanceResolvedByHistory;
        const isBookingWaitingAttendance = currentBookingId && anyNotificationSent && !anyAttendanceResolved;

        let bookingAttendanceNoShowByHistory = false;
        if (
          currentBookingId &&
          anyAttendanceResolved &&
          !bookingAttendanceNoShowByCol &&
          hasAnyAttendanceResolvedByHistory &&
          String(currentBooking?.attendance_status ?? "").trim().toLowerCase() === ""
        ) {
          try {
            const { data: histAtt2 } = await admin
              .from("atendimento_history_events")
              .select("event_type")
              .eq("lead_id", leadId)
              .eq("conversation_id", conversationId)
              .eq("event_type", "experimental_class_attendance_no_show")
              .limit(1);
            bookingAttendanceNoShowByHistory =
              Array.isArray((histAtt2 as any) ?? []) && (histAtt2 as any).length > 0;
          } catch (_e) {
            bookingAttendanceNoShowByHistory = false;
          }
        }

        let bookingAttendanceAttendedByHistory = false;
        if (
          currentBookingId &&
          anyAttendanceResolved &&
          !bookingAttendanceAttendedByCol &&
          hasAnyAttendanceResolvedByHistory &&
          String(currentBooking?.attendance_status ?? "").trim().toLowerCase() === ""
        ) {
          try {
            const { data: histAtt3 } = await admin
              .from("atendimento_history_events")
              .select("event_type")
              .eq("lead_id", leadId)
              .eq("conversation_id", conversationId)
              .eq("event_type", "experimental_class_attendance_attended")
              .limit(1);
            bookingAttendanceAttendedByHistory =
              Array.isArray((histAtt3 as any) ?? []) && (histAtt3 as any).length > 0;
          } catch (_e) {
            bookingAttendanceAttendedByHistory = false;
          }
        }

        const postAttendanceMatriculaPendenteByLead =
          (funnelStageRaw === "matricula_pendente" || leadStatusRaw === "matricula_pendente") &&
          postAttendanceHistoryConfirmedAttendedEvent &&
          !postAttendanceHistoryMatriculaRecusadaEvent;
        const postAttendanceMatriculaRecusadaByLead =
          postAttendanceHistoryMatriculaRecusadaEvent ||
          ((funnelStageRaw === "matricula_pendente_recusada" ||
            leadStatusRaw === "matricula_pendente_recusada") &&
            postAttendanceHistoryConfirmedAttendedEvent);
        const postAttendanceRepescagemByLead =
          isLeadRepescagemStatus && postAttendanceHistoryConfirmedNoShowEvent;

        const isLeadInRepescagemNoShowLocked =
          isLeadRepescagemStatus ||
          postAttendanceRepescagemByLead ||
          (currentBookingId &&
            anyAttendanceResolved &&
            (bookingAttendanceNoShowByCol || bookingAttendanceNoShowByHistory));

        const isLeadInMatriculaPendentePostAttendance =
          (!isLeadInRepescagemNoShowLocked || postAttendanceMatriculaPendenteByLead) &&
          (Boolean(currentBookingId) || postAttendanceMatriculaPendenteByLead) &&
          (anyAttendanceResolved || postAttendanceMatriculaPendenteByLead) &&
          (bookingAttendanceAttendedByCol ||
            bookingAttendanceAttendedByHistory ||
            postAttendanceMatriculaPendenteByLead);

        const isLeadInMatriculaRecusadaPosAttendance =
          postAttendanceMatriculaRecusadaByLead ||
          ((!isLeadInRepescagemNoShowLocked || postAttendanceMatriculaRecusadaByLead) &&
            (Boolean(currentBookingId) || postAttendanceMatriculaRecusadaByLead) &&
            (anyAttendanceResolved || postAttendanceMatriculaRecusadaByLead) &&
            (bookingAttendanceAttendedByCol ||
              bookingAttendanceAttendedByHistory ||
              postAttendanceMatriculaRecusadaByLead) &&
            (funnelStageRaw === "matricula_pendente_recusada" ||
              leadStatusRaw === "matricula_pendente_recusada"));

        const handledByPosAttendanceFlowByLead =
          postAttendanceMatriculaRecusadaByLead ||
          postAttendanceMatriculaPendenteByLead ||
          postAttendanceRepescagemByLead;

        const effectiveWaitMessage = (() => {
          if (
            leadEstaEmMatriculaPendentePosAttendance ||
            leadEstaEmMatriculaRecusadaPosAttendance ||
            leadEstaEmRepescagemNoShow ||
            postAttendanceMatriculaRecusadaByLead ||
            postAttendanceMatriculaPendenteByLead ||
            postAttendanceRepescagemByLead ||
            handledByPosAttendanceFlowNuclear
          ) {
            return null;
          }
          return anyNotificationSent
            ? EXPERIMENTAL_CLASS_POST_NOTIFICATION_WAIT_MESSAGE
            : EXPERIMENTAL_CLASS_FINAL_WAIT_MESSAGE;
        })();

        const handledByPosAttendanceFlow =
          isLeadInMatriculaRecusadaPosAttendance ||
          isLeadInMatriculaPendentePostAttendance ||
          isLeadInRepescagemNoShowLocked ||
          handledByPosAttendanceFlowByLead ||
          handledByPosAttendanceFlowNuclear;

        if (isLeadInMatriculaRecusadaPosAttendance) {
          const inboundContent = String(messageText ?? "").trim();
          const inboundMediaType = mediaInfo.hasPaymentMedia
            ? (mediaInfo.mediaUrl ? "document" : "text")
            : "text";
          const inboundMediaUrl = mediaInfo.mediaUrl || null;
          try {
            const { error: inboundErr } = await admin
              .from("atendimento_messages")
              .insert({
                conversation_id: conversationId,
                sender_role: "lead",
                content_text: inboundContent || null,
                media_type: inboundMediaType,
                media_url: inboundMediaUrl,
                status: "recebida",
                sent_at: nowIso,
                delivered_at: nowIso,
              });
            if (!inboundErr) {
              try {
                void admin
                  .from("atendimento_leads")
                  .update({
                    unread_count: Number(lead.unread_count ?? 0) + 1,
                    is_new_for_attendant: true,
                    last_interaction_at: nowIso,
                    updated_at: nowIso,
                  })
                  .eq("id", leadId);
              } catch (_e) {}
              try {
                void syncConversationPreview({
                  conversationId,
                  contentText: inboundContent || "(mensagem recebida)",
                  createdAt: nowIso,
                });
              } catch (_e) {}
            }
          } catch (_e) {}
          try {
            await insertWhatsAppBotTextMessage({
              admin,
              conversationId,
              contentText: RESPOSTA_REPESCAGEM_FIXA,
            });
          } catch (_e) {}
          try {
            await sendAtendimentoWhatsAppText({
              phone: normalizedPhoneOnly,
              message: RESPOSTA_REPESCAGEM_FIXA,
            });
          } catch (_e) {}
          try {
            void appendHistoryEvent({
              leadId,
              conversationId,
              eventType: "whatsapp_matricula_recusada_fixed_reply",
              title: "Fluxo encerrado: resposta fixa após recusa de matrícula",
              details: {
                inbound_content_text: inboundContent || null,
                reply_text: RESPOSTA_REPESCAGEM_FIXA,
                source: "whatsapp_zapi",
                booking_attendance_attended_by_col: bookingAttendanceAttendedByCol,
                booking_attendance_attended_by_history: bookingAttendanceAttendedByHistory,
              },
              actorType: "bot",
            });
          } catch (_e) {}
          return Response.json({
            ok: true,
            handled: true,
            flow: "whatsapp_matricula_recusada_locked",
          });
        }

        if (isLeadInMatriculaPendentePostAttendance && !isLeadInRepescagemNoShowLocked) {
          const inboundContent = String(messageText ?? "").trim();
          const inboundMediaType = mediaInfo.hasPaymentMedia
            ? (mediaInfo.mediaUrl ? "document" : "text")
            : "text";
          const inboundMediaUrl = mediaInfo.mediaUrl || null;
          try {
            const { error: inboundErr } = await admin
              .from("atendimento_messages")
              .insert({
                conversation_id: conversationId,
                sender_role: "lead",
                content_text: inboundContent || null,
                media_type: inboundMediaType,
                media_url: inboundMediaUrl,
                status: "recebida",
                sent_at: nowIso,
                delivered_at: nowIso,
              });
            if (!inboundErr) {
              try {
                void admin
                  .from("atendimento_leads")
                  .update({
                    unread_count: Number(lead.unread_count ?? 0) + 1,
                    is_new_for_attendant: true,
                    last_interaction_at: nowIso,
                    updated_at: nowIso,
                  })
                  .eq("id", leadId);
              } catch (_e) {}
              try {
                void syncConversationPreview({
                  conversationId,
                  contentText: inboundContent || "(mensagem recebida)",
                  createdAt: nowIso,
                });
              } catch (_e) {}
            }
          } catch (_e) {}

          const inboundNormalized = inboundContent
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim()
            .replace(/[.!?,\s]+$/g, "")
            .toLowerCase();

          const isYes =
            inboundNormalized === "sim" ||
            inboundNormalized === "s" ||
            /^sim\b/i.test(inboundNormalized) ||
            inboundNormalized.replace(/\s+/g, "") === "sim";

          const isNo =
            inboundNormalized === "nao" ||
            inboundNormalized === "n" ||
            /^nao\b/i.test(inboundNormalized) ||
            inboundNormalized.replace(/\s+/g, "") === "nao" ||
            /^n[aãâ]o\b/i.test(inboundContent.trim());

          let replyText = MSG_SIM_NAO_INVALIDA;
          let noReplies: string[] = [];
          let nextLeadFunnel = "matricula_pendente";
          let nextLeadStatus = "matricula_pendente";
          let historyEventType = "matricula_pendente_sim_nao_invalida";
          let historyTitle = "Matrícula pendente: resposta inválida, pedindo sim/não";

          if (isYes) {
            replyText =
              "Perfeito! Em breve nossa equipe entrará em contato para finalizar sua matrícula.";
            nextLeadFunnel = "matricula_confirmada";
            nextLeadStatus = "matricula_confirmada";
            historyEventType = "matricula_pendente_resposta_sim";
            historyTitle = "Matrícula pendente: lead respondeu SIM";
          } else if (isNo) {
            noReplies = [
              "Tudo bem, entendemos que talvez ainda não seja o momento.",
              "Em breve nossa equipe entrará em contato.",
            ];
            nextLeadFunnel = "matricula_pendente_recusada";
            nextLeadStatus = "matricula_pendente_recusada";
            historyEventType = "matricula_pendente_resposta_nao";
            historyTitle = "Matrícula pendente: lead respondeu NÃO";
          }

          try {
            const leadUpdate: Record<string, unknown> = {
              funnel_stage: nextLeadFunnel,
              status: nextLeadStatus,
              updated_at: nowIso,
            };
            await admin.from("atendimento_leads").update(leadUpdate).eq("id", leadId);
          } catch (_e) {
            const msg = String((_e as any)?.message ?? "");
            const code = String((_e as any)?.code ?? "");
            if (
              code !== "42703" &&
              code !== "PGRST204" &&
              code !== "PGRST205" &&
              !/column|does not exist/i.test(msg)
            ) {
              void appendHistoryEvent({
                leadId,
                conversationId,
                eventType: "matricula_lead_update_failed",
                title: "Falha ao atualizar lead (matrícula flow)",
                details: {
                  error_message: msg,
                  error_code: code,
                  try_next_funnel: nextLeadFunnel,
                  try_next_status: nextLeadStatus,
                },
                actorType: "system",
              });
            }
          }

          if (isNo && noReplies.length > 0) {
            for (const msgTxt of noReplies) {
              try {
                await insertWhatsAppBotTextMessage({
                  admin,
                  conversationId,
                  contentText: msgTxt,
                });
              } catch (_e) {}
              try {
                await sendAtendimentoWhatsAppText({
                  phone: normalizedPhoneOnly,
                  message: msgTxt,
                });
              } catch (_e) {}
            }
          } else {
            try {
              await insertWhatsAppBotTextMessage({
                admin,
                conversationId,
                contentText: replyText,
              });
            } catch (_e) {}
            try {
              await sendAtendimentoWhatsAppText({
                phone: normalizedPhoneOnly,
                message: replyText,
              });
            } catch (_e) {}
          }

          try {
            void appendHistoryEvent({
              leadId,
              conversationId,
              eventType: historyEventType,
              title: historyTitle,
              details: {
                inbound_content_text: inboundContent || null,
                inbound_normalized: inboundNormalized || null,
                is_yes: isYes,
                is_no: isNo,
                reply_text: isNo ? noReplies.join("\n---\n") : replyText,
                next_funnel_stage: nextLeadFunnel,
                next_status: nextLeadStatus,
                source: "whatsapp_zapi",
                booking_attendance_attended_by_col: bookingAttendanceAttendedByCol,
                booking_attendance_attended_by_history: bookingAttendanceAttendedByHistory,
              },
              actorType: "bot",
            });
          } catch (_e) {}

          if (isYes || isNo) {
            try {
              await admin
                .from("atendimento_conversations")
                .update({ bot_enabled: true, updated_at: nowIso })
                .eq("id", conversationId);
            } catch (_e) {
              const msg = String((_e as any)?.message ?? "");
              const code = String((_e as any)?.code ?? "");
              if (
                code !== "42703" &&
                code !== "PGRST204" &&
                code !== "PGRST205" &&
                !/bot_enabled/i.test(msg)
              ) {
                // ignore missing column; rest flow already returned handled:true
              }
            }
          }

          return Response.json({
            ok: true,
            handled: true,
            flow: "whatsapp_post_attendance_matricula_pendente",
            is_yes: isYes,
            is_no: isNo,
          });
        }

        if (isLeadInRepescagemNoShowLocked) {
          const inboundContent = String(messageText ?? "").trim();
          const inboundMediaType = mediaInfo.hasPaymentMedia
            ? (mediaInfo.mediaUrl ? "document" : "text")
            : "text";
          const inboundMediaUrl = mediaInfo.mediaUrl || null;
          try {
            const { error: inboundErr } = await admin
              .from("atendimento_messages")
              .insert({
                conversation_id: conversationId,
                sender_role: "lead",
                content_text: inboundContent || null,
                media_type: inboundMediaType,
                media_url: inboundMediaUrl,
                status: "recebida",
                sent_at: nowIso,
                delivered_at: nowIso,
              });
            if (!inboundErr) {
              try {
                void admin
                  .from("atendimento_leads")
                  .update({
                    unread_count: Number(lead.unread_count ?? 0) + 1,
                    is_new_for_attendant: true,
                    last_interaction_at: nowIso,
                    updated_at: nowIso,
                  })
                  .eq("id", leadId);
              } catch (_e) {}
              try {
                void syncConversationPreview({
                  conversationId,
                  contentText: inboundContent || "(mensagem recebida)",
                  createdAt: nowIso,
                });
              } catch (_e) {}
            }
          } catch (_e) {}
          try {
            await insertWhatsAppBotTextMessage({
              admin,
              conversationId,
              contentText: RESPOSTA_REPESCAGEM_FIXA,
            });
          } catch (_e) {}
          try {
            await sendAtendimentoWhatsAppText({
              phone: normalizedPhoneOnly,
              message: RESPOSTA_REPESCAGEM_FIXA,
            });
          } catch (_e) {}
          try {
            void appendHistoryEvent({
              leadId,
              conversationId,
              eventType: "whatsapp_repescagem_no_show_fixed_reply",
              title: "Fluxo encerrado: resposta fixa de repescagem",
              details: {
                inbound_content_text: inboundContent || null,
                reply_text: RESPOSTA_REPESCAGEM_FIXA,
                source: "whatsapp_zapi",
                is_lead_repescagem_status: isLeadRepescagemStatus,
                booking_attendance_no_show_by_col: bookingAttendanceNoShowByCol,
                booking_attendance_no_show_by_history: bookingAttendanceNoShowByHistory,
              },
              actorType: "bot",
            });
          } catch (_e) {}
          return Response.json({
            ok: true,
            handled: true,
            flow: "whatsapp_repescagem_no_show_locked",
          });
        }

        if (isBookingWaitingAttendance) {
          const inboundContent = String(messageText ?? "").trim();
          const inboundMediaType = mediaInfo.hasPaymentMedia
            ? (mediaInfo.mediaUrl ? "document" : "text")
            : "text";
          const inboundMediaUrl = mediaInfo.mediaUrl || null;
          try {
            const { error: inboundErr } = await admin
              .from("atendimento_messages")
              .insert({
                conversation_id: conversationId,
                sender_role: "lead",
                content_text: inboundContent || null,
                media_type: inboundMediaType,
                media_url: inboundMediaUrl,
                status: "recebida",
                sent_at: nowIso,
                delivered_at: nowIso,
              });
            if (!inboundErr) {
              try {
                void admin
                  .from("atendimento_leads")
                  .update({
                    unread_count: Number(lead.unread_count ?? 0) + 1,
                    is_new_for_attendant: true,
                    last_interaction_at: nowIso,
                    updated_at: nowIso,
                  })
                  .eq("id", leadId);
              } catch (_e) {}
              try {
                void syncConversationPreview({
                  conversationId,
                  contentText: inboundContent || "(mensagem recebida)",
                  createdAt: nowIso,
                });
              } catch (_e) {}
              try {
                void appendHistoryEvent({
                  leadId,
                  conversationId,
                  eventType: "message_received_class_in_progress",
                  title: "Mensagem recebida (aula em andamento — bloqueada)",
                  details: {
                    content_text: inboundContent || null,
                    media_type: inboundMediaType,
                    media_url: inboundMediaUrl,
                    booking_id: currentBookingId,
                    source: "whatsapp_zapi",
                  },
                  actorType: "lead",
                });
              } catch (_e) {}
            }
          } catch (_e) {}
          return Response.json({
            ok: true,
            ignored: true,
            reason: "experimental_class_waiting_attendance_blocked",
            booking_id: currentBookingId,
            attendance_status: String(currentBooking.attendance_status ?? "") || null,
            student_start_notification_sent_at: currentBooking.student_start_notification_sent_at || null,
            attendant_start_notification_sent_at: currentBooking.attendant_start_notification_sent_at || null,
          });
        }

        if (!conversation.bot_enabled) {
          if (isBookingWaitingAttendance || handledByPosAttendanceFlow) {
            return Response.json({
              ok: true,
              ignored: true,
              reason: isBookingWaitingAttendance
                ? "conversation_blocked_waiting_attendance_no_reply"
                : "conversation_blocked_pos_attendance_handled_above",
              booking_id: currentBookingId,
            });
          }
          let finalReason = "conversation_blocked";
          let responseMessage: string | null = null;
          const hasBooking = currentBookingId ? currentBooking : null;
          if (hasBooking?.id && !handledByPosAttendanceFlow && effectiveWaitMessage) {
            finalReason = "conversation_blocked_echo_booking_scheduled";
            responseMessage = effectiveWaitMessage;
          } else {
            const histFinal = await admin
              .from("atendimento_history_events")
              .select("event_type")
              .eq("lead_id", leadId)
              .eq("conversation_id", conversationId)
              .in("event_type", [
                "experimental_class_scheduled",
                "whatsapp_flow_concluded_bot_disabled",
                "whatsapp_flow_blocked_max_attempts",
              ])
              .order("created_at", { ascending: false })
              .limit(3);
            const events = (histFinal.data ?? []) as Array<{ event_type: string }>;
            const hasScheduled = events.some(
              (e) =>
                e.event_type === "experimental_class_scheduled" ||
                e.event_type === "whatsapp_flow_concluded_bot_disabled",
            );
            const hasBlockedMaxAttempts = events.some(
              (e) => e.event_type === "whatsapp_flow_blocked_max_attempts",
            );
            if (hasScheduled && !handledByPosAttendanceFlow && effectiveWaitMessage) {
              finalReason = "conversation_blocked_echo_scheduled_by_history";
              responseMessage = effectiveWaitMessage;
            } else if (hasBlockedMaxAttempts) {
              const lastBotMsg = await getLastBotMessage({ admin, conversationId });
              const lastBotText = String(lastBotMsg?.content_text ?? "").trim();
              finalReason = "conversation_blocked_support_max_attempts";
              if (!lastBotText || lastBotText !== SUPPORT_FINAL_MESSAGE) {
                responseMessage = SUPPORT_FINAL_MESSAGE;
              }
            } else {
              const lastBotMsg = await getLastBotMessage({ admin, conversationId });
              const lastBotText = String(lastBotMsg?.content_text ?? "").trim();
              if (!lastBotText || lastBotText !== SUPPORT_FINAL_MESSAGE) {
                responseMessage = SUPPORT_FINAL_MESSAGE;
              }
            }
          }
          if (responseMessage && !isBookingWaitingAttendance && !handledByPosAttendanceFlow) {
            try {
              await insertWhatsAppBotTextMessage({
                admin,
                conversationId,
                contentText: responseMessage,
              });
            } catch (_e) {}
            try {
              await sendAtendimentoWhatsAppText({
                phone: normalizedPhoneOnly,
                message: responseMessage,
              });
            } catch (_e) {}
          }
          return Response.json({
            ok: true,
            ignored: true,
            reason: finalReason,
          });
        }

        const inboundContent = String(messageText ?? "").trim();
        const inboundMediaType = mediaInfo.hasPaymentMedia
          ? (mediaInfo.mediaUrl ? "document" : "text")
          : "text";
        const inboundMediaUrl = mediaInfo.mediaUrl || null;

        const { data: inboundMsg, error: inboundErr } = await admin
          .from("atendimento_messages")
          .insert({
            conversation_id: conversationId,
            sender_role: "lead",
            content_text: inboundContent || null,
            media_type: inboundMediaType,
            media_url: inboundMediaUrl,
            status: "recebida",
            sent_at: nowIso,
            delivered_at: nowIso,
          })
          .select("*")
          .maybeSingle();

        if (!inboundErr && inboundMsg?.id) {
          void admin
            .from("atendimento_leads")
            .update({
              unread_count: Number(lead.unread_count ?? 0) + 1,
              is_new_for_attendant: true,
              last_interaction_at: nowIso,
              updated_at: nowIso,
            })
            .eq("id", leadId);

          void syncConversationPreview({
            conversationId,
            contentText: inboundContent || "(mensagem recebida)",
            createdAt: nowIso,
          });

          void appendHistoryEvent({
            leadId,
            conversationId,
            eventType: "message_received",
            title: "Mensagem recebida do lead via WhatsApp",
            details: {
              content_text: inboundContent || null,
              media_type: inboundMediaType,
              media_url: inboundMediaUrl,
              source: "whatsapp_zapi",
            },
            actorType: "lead",
          });
        }

        const isFirstBotInteraction = !(await hasAnyBotMessage({ conversationId }));
        const lastBot = await getLastBotMessage({ admin, conversationId });
        const lastBotText = String(lastBot?.content_text ?? "").trim();
        const expectedFieldByText = inferExpectedWhatsAppFieldFromLastBot(lastBotText);
        const expectedFieldByHistory = await detectExpectedWhatsAppFieldFromHistory({
          admin,
          leadId,
          conversationId,
        });
        let expectedField = expectedFieldByText ?? expectedFieldByHistory;
        const nextMissingField = getWhatsAppNextMissingField(lead);

        const existingBooking = currentBookingId ? currentBooking : null;
        const existingScheduledBookingId = existingBooking?.id ? String(existingBooking.id) : "";
        const bookingAttendanceFullyResolvedEcho =
          bookingAttendanceAttendedByCol || bookingAttendanceNoShowByCol;
        if (
          existingScheduledBookingId &&
          !isBookingWaitingAttendance &&
          bookingAttendanceFullyResolvedEcho &&
          conversation.bot_enabled !== false &&
          !handledByPosAttendanceFlow
        ) {
          try {
            await admin
              .from("atendimento_conversations")
              .update({
                bot_enabled: false,
                updated_at: nowIso,
              })
              .eq("id", conversationId);
          } catch (_e) {}
        }
        if (existingScheduledBookingId && !isBookingWaitingAttendance && bookingAttendanceFullyResolvedEcho) {
          if (handledByPosAttendanceFlow) {
            return Response.json({
              ok: true,
              ignored: true,
              reason: "flow_concluded_pos_attendance_handled_skip_scheduled_echo",
              booking_id: existingScheduledBookingId,
            });
          }
          if (!effectiveWaitMessage) {
            return Response.json({
              ok: true,
              ignored: true,
              reason: "flow_concluded_scheduled_echo_wait_message_null_skip",
              booking_id: existingScheduledBookingId,
            });
          }
          try {
            await insertWhatsAppBotTextMessage({
              admin,
              conversationId,
              contentText: effectiveWaitMessage,
            });
          } catch (_e) {}
          try {
            await sendAtendimentoWhatsAppText({
              phone: normalizedPhoneOnly,
              message: effectiveWaitMessage,
            });
          } catch (_e) {}
          return Response.json({
            ok: true,
            ignored: true,
            reason: "flow_concluded_aula_experimental_ja_agendada_echo",
            booking_id: existingScheduledBookingId,
          });
        }

        const histFlowRecent = await admin
          .from("atendimento_history_events")
          .select("event_type,created_at")
          .eq("lead_id", leadId)
          .eq("conversation_id", conversationId)
          .in("event_type", [
            "experimental_class_scheduled",
            "whatsapp_flow_concluded_bot_disabled",
            "whatsapp_flow_blocked_max_attempts",
          ])
          .order("created_at", { ascending: false })
          .limit(3);
        const eventsFlowRecent = (histFlowRecent.data ?? []) as Array<{ event_type: string }>;
        const recentFlowConclusion = eventsFlowRecent.length > 0;
        const recentIsScheduled = eventsFlowRecent.some(
          (e) =>
            e.event_type === "experimental_class_scheduled" ||
            e.event_type === "whatsapp_flow_concluded_bot_disabled",
        );
        const recentIsMaxAttemptsBlocked = eventsFlowRecent.some(
          (e) => e.event_type === "whatsapp_flow_blocked_max_attempts",
        );
        if (
          recentFlowConclusion &&
          conversation.bot_enabled !== false &&
          !handledByPosAttendanceFlow &&
          bookingAttendanceFullyResolvedEcho
        ) {
          try {
            await admin
              .from("atendimento_conversations")
              .update({
                bot_enabled: false,
                updated_at: nowIso,
              })
              .eq("id", conversationId);
          } catch (_e) {}
        }
        if (recentFlowConclusion) {
          if (handledByPosAttendanceFlow) {
            return Response.json({
              ok: true,
              ignored: true,
              reason: "flow_concluded_pos_attendance_handled_skip_history",
              event_types: eventsFlowRecent.map((e: any) => e.event_type),
            });
          }
          if (!bookingAttendanceFullyResolvedEcho) {
            return Response.json({
              ok: true,
              ignored: false,
              reason: "flow_concluded_history_attendance_not_resolved_yet_continue_normal_flow",
              event_types: eventsFlowRecent.map((e: any) => e.event_type),
            });
          }
          if (isBookingWaitingAttendance) {
            return Response.json({
              ok: true,
              ignored: false,
              reason: "flow_concluded_history_waiting_attendance_continue_normal_flow",
              booking_id: currentBookingId,
              event_types: eventsFlowRecent.map((e: any) => e.event_type),
            });
          }
          let finalMsg: string | null = null;
          let finalReason = "flow_concluded_already_finalized_in_history_event";
          if (recentIsScheduled) {
            finalMsg = effectiveWaitMessage;
            if (!finalMsg) {
              return Response.json({
                ok: true,
                ignored: true,
                reason: "flow_concluded_echo_scheduled_by_history_wait_message_null_skip",
                event_types: eventsFlowRecent.map((e: any) => e.event_type),
              });
            }
            finalReason = "flow_concluded_echo_scheduled_by_history";
          } else if (recentIsMaxAttemptsBlocked) {
            const lastBotMsg = await getLastBotMessage({ admin, conversationId });
            const lastBotText = String(lastBotMsg?.content_text ?? "").trim();
            if (!lastBotText || lastBotText !== SUPPORT_FINAL_MESSAGE) {
              finalMsg = SUPPORT_FINAL_MESSAGE;
            }
            finalReason = "flow_concluded_support_max_attempts_by_history";
          }
          if (finalMsg) {
            try {
              await insertWhatsAppBotTextMessage({
                admin,
                conversationId,
                contentText: finalMsg,
              });
            } catch (_e) {}
            try {
              await sendAtendimentoWhatsAppText({
                phone: normalizedPhoneOnly,
                message: finalMsg,
              });
            } catch (_e) {}
          }
          return Response.json({
            ok: true,
            ignored: true,
            reason: finalReason,
            event_types: eventsFlowRecent.map((e: any) => e.event_type),
          });
        }

        const histStateMatch = await admin
          .from("atendimento_history_events")
          .select("event_type,details,created_at")
          .eq("lead_id", leadId)
          .eq("conversation_id", conversationId)
          .in("event_type", ["state_collected", "city_collected"])
          .order("created_at", { ascending: false })
          .limit(2);
        const lastHistState =
          histStateMatch.data?.find((e: any) => e.event_type === "state_collected") ?? null;
        const lastHistCity =
          histStateMatch.data?.find((e: any) => e.event_type === "city_collected") ?? null;
        let histStateValue = String((lastHistState as any)?.details?.state ?? "").trim();
        let histTimezone = String((lastHistState as any)?.details?.timezone ?? "").trim();
        let histCityValue = String((lastHistCity as any)?.details?.city ?? "").trim();

        const leadStateValue =
          String((lead as any)?.state ?? "").trim() || histStateValue;
        const leadTimezoneValue =
          String((lead as any)?.timezone ?? "").trim() || histTimezone;
        const leadCityValue = String((lead as any)?.city ?? "").trim() || histCityValue;
        const leadFunnelStage = String((lead as any)?.funnel_stage ?? "").trim();
        const hasStateValidated = Boolean(leadStateValue && leadTimezoneValue);
        const hasCityValidated = Boolean(leadCityValue && hasStateValidated);
        const hasReachedPostCityStage =
          hasCityValidated ||
          (leadFunnelStage === "pre_cadastro_concluido" ||
            leadFunnelStage === "aula_experimental_agendada" ||
            leadFunnelStage === "em_atendimento") ||
          Boolean(lastHistCity);


        if (expectedField === "state" && hasStateValidated) {
          expectedField = hasCityValidated ? (nextMissingField ?? null) : "city";
        }
        if (expectedFieldByText === "city" && hasStateValidated && !hasCityValidated) {
          expectedField = "city";
        }
        if (expectedField === "city" && hasCityValidated) {
          expectedField = nextMissingField ?? null;
        }
        if (!expectedField && hasReachedPostCityStage) {
          expectedField = nextMissingField ?? expectedField;
        }
        if (expectedField === "state" && hasReachedPostCityStage) {
          expectedField = nextMissingField ?? null;
        }
        if (expectedField === "city" && !hasStateValidated) {
          expectedField = "state";
        }

        if (isFirstBotInteraction) {
          const firstMessage =
            "Para agendarmos sua aula experimental gratuita, preciso de algumas informações rápidas. Vamos começar?";
          const secondMessage = "Em qual estado você mora?";

          await insertWhatsAppBotTextMessage({
            admin,
            conversationId,
            contentText: firstMessage,
          });
          await insertWhatsAppBotTextMessage({
            admin,
            conversationId,
            contentText: secondMessage,
          });

          try {
            await sendAtendimentoWhatsAppText({
              phone: normalizedPhoneOnly,
              message: firstMessage,
            });
          } catch (_sendErr) {}
          try {
            await sendAtendimentoWhatsAppText({
              phone: normalizedPhoneOnly,
              message: secondMessage,
            });
          } catch (_sendErr) {}

          void appendHistoryEvent({
            leadId,
            conversationId,
            eventType: "lead_timezone_collection_started",
            title: "Coleta de estado e cidade iniciada diretamente via WhatsApp",
            details: {
              phone: normalizedPhoneOnly,
              source: "manual_collection_whatsapp",
              first_message: inboundContent || null,
            },
            actorType: "system",
          });

          return Response.json({
            ok: true,
            handled: true,
            flow: "whatsapp_direct_lead_first",
          });
        }

        const wantsStateStage = expectedField === "state" || (!expectedField && nextMissingField === "state");
        if (wantsStateStage && !hasStateValidated && !hasReachedPostCityStage) {
          const stateResolution = resolveTimeZoneFromStateInput({
            state: inboundContent,
            phone: normalizedPhoneOnly,
          });
          if (!stateResolution) {
            const nextFail =
              (await countWhatsAppLocationFailures({ admin, leadId, conversationId, field: "state" })) + 1;
            const blocked = nextFail >= MAX_LOCATION_WHATSAPP_ATTEMPTS;

            void appendHistoryEvent({
              leadId,
              conversationId,
              eventType: "state_validation_failed",
              title: "Falha ao identificar estado informado via WhatsApp",
              details: {
                attempt: nextFail,
                content_text: inboundContent || null,
                blocked,
              },
              actorType: "system",
            });

            if (blocked) {
              await sendSupportFinalAndMarkBlocked({
                admin,
                leadId,
                conversationId,
                normalizedPhoneOnly,
                blockedStage: "state",
                attempt: nextFail,
                contentText: inboundContent,
              });
              return Response.json({
                ok: true,
                handled: true,
                flow: "whatsapp_state_blocked_support",
                blocked: true,
              });
            }

            const msg = `${LOCATION_STATE_INVALID_MESSAGE}\n\nTentativa ${nextFail} de ${MAX_LOCATION_WHATSAPP_ATTEMPTS}.`;
            await insertWhatsAppBotTextMessage({ admin, conversationId, contentText: msg });
            try {
              await sendAtendimentoWhatsAppText({ phone: normalizedPhoneOnly, message: msg });
            } catch (_e) {}

            return Response.json({
              ok: true,
              handled: true,
              flow: "whatsapp_state_retry",
              blocked: false,
            });
          }

          const stateUpdate = admin
            .from("atendimento_leads")
            .update({
              state: stateResolution.state,
              timezone: stateResolution.timeZone,
              country: stateResolution.country === "BR" ? "Brasil" : "Estados Unidos",
              updated_at: nowIso,
            })
            .eq("id", leadId);
          try {
            await stateUpdate;
          } catch (_e) {}

          void appendHistoryEvent({
            leadId,
            conversationId,
            eventType: "state_collected",
            title: "Estado do lead identificado e salvo via WhatsApp",
            details: {
              state: stateResolution.state,
              normalized_state: stateResolution.normalizedState,
              timezone: stateResolution.timeZone,
              country: stateResolution.country === "BR" ? "Brasil" : "Estados Unidos",
            },
            actorType: "system",
          });

          const nextMsg = CAPTURED_FIELD_PROMPTS.city;
          await insertWhatsAppBotTextMessage({ admin, conversationId, contentText: nextMsg });
          try {
            await sendAtendimentoWhatsAppText({ phone: normalizedPhoneOnly, message: nextMsg });
          } catch (_e) {}

          void appendHistoryEvent({
            leadId,
            conversationId,
            eventType: "city_prompt_presented",
            title: "Solicitada cidade do lead após estado identificado",
            details: {
              prompt: nextMsg,
              state: stateResolution.state,
            },
            actorType: "system",
          });

          return Response.json({
            ok: true,
            handled: true,
            flow: "whatsapp_state_collected",
          });
        }

        const wantsCityStage = expectedField === "city" || (!expectedField && nextMissingField === "city");
        if (wantsCityStage && hasStateValidated && !hasCityValidated && !hasReachedPostCityStage) {
          const stateSoFar = String((lead as any)?.state ?? "").trim();
          const inputCheck = isValidCityInput(inboundContent);
          const rawResolved = inputCheck.valid
            ? resolveTimeZoneFromCityInput({
                city: inboundContent,
                state: stateSoFar || null,
                phone: normalizedPhoneOnly,
                allowPhoneCountryFallback: true,
              })
            : null;
          const resolved = cityResolutionIsReliable(rawResolved) ? rawResolved : null;

          if (!resolved) {
            const nextFail =
              (await countWhatsAppLocationFailures({ admin, leadId, conversationId, field: "city" })) + 1;
            const blocked = nextFail >= MAX_LOCATION_WHATSAPP_ATTEMPTS;

            void appendHistoryEvent({
              leadId,
              conversationId,
              eventType: "city_validation_failed",
              title: "Falha ao identificar cidade informada via WhatsApp",
              details: {
                attempt: nextFail,
                content_text: inboundContent || null,
                blocked,
                state: stateSoFar || null,
              },
              actorType: "system",
            });

            if (blocked) {
              await sendSupportFinalAndMarkBlocked({
                admin,
                leadId,
                conversationId,
                normalizedPhoneOnly,
                blockedStage: "city",
                attempt: nextFail,
                contentText: inboundContent,
              });
              return Response.json({
                ok: true,
                handled: true,
                flow: "whatsapp_city_blocked_support",
                blocked: true,
              });
            }

            const msg = `${LOCATION_CITY_INVALID_MESSAGE}\n\nTentativa ${nextFail} de ${MAX_LOCATION_WHATSAPP_ATTEMPTS}.`;
            await insertWhatsAppBotTextMessage({ admin, conversationId, contentText: msg });
            try {
              await sendAtendimentoWhatsAppText({ phone: normalizedPhoneOnly, message: msg });
            } catch (_e) {}

            return Response.json({
              ok: true,
              handled: true,
              flow: "whatsapp_city_retry",
              blocked: false,
            });
          }

          const cityUpdate = admin
            .from("atendimento_leads")
            .update({
              city: resolved.city,
              state: resolved.state ?? (String((lead as any)?.state ?? "").trim() || null),
              timezone: resolved.timeZone,
              country: resolved.country === "BR" ? "Brasil" : "Estados Unidos",
              funnel_stage: "pre_cadastro_concluido",
              status: "matricula_pendente",
              updated_at: nowIso,
            })
            .eq("id", leadId);
          try {
            await cityUpdate;
          } catch (_e) {}

          void appendHistoryEvent({
            leadId,
            conversationId,
            eventType: "city_collected",
            title: "Cidade do lead identificada e salva via WhatsApp",
            details: {
              state: resolved.state,
              city: resolved.city,
              timezone: resolved.timeZone,
              country: resolved.country === "BR" ? "Brasil" : "Estados Unidos",
              source: resolved.source,
            },
            actorType: "system",
          });

          void appendHistoryEvent({
            leadId,
            conversationId,
            eventType: "lead_timezone_identified",
            title: "Cidade e fuso do lead identificados via WhatsApp",
            details: {
              state: resolved.state,
              city: resolved.city,
              timezone: resolved.timeZone,
              teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
              country: resolved.country === "BR" ? "Brasil" : "Estados Unidos",
              source: resolved.source,
            },
            actorType: "system",
          });

          const introMsgs = buildExperimentalClassDatePromptMessages(
            String((lead as any)?.full_name ?? "").trim() || null,
          );
          for (const introMsg of introMsgs) {
            await insertWhatsAppBotTextMessage({ admin, conversationId, contentText: introMsg });
            try {
              await sendAtendimentoWhatsAppText({ phone: normalizedPhoneOnly, message: introMsg });
            } catch (_e) {}
          }

          const { messages: dateMessages } = await presentExperimentalClassDateOptionsWhatsApp({
            admin,
            leadId,
            conversationId,
            leadTimeZone: resolved.timeZone,
          });
          for (const dateMsg of dateMessages) {
            const cleanMsg = String(dateMsg ?? "").trim();
            if (!cleanMsg) continue;
            try {
              await sendAtendimentoWhatsAppText({ phone: normalizedPhoneOnly, message: cleanMsg });
            } catch (_e) {}
          }

          return Response.json({
            ok: true,
            handled: true,
            flow: "whatsapp_city_collected_date_presented",
          });
        }

        if (!expectedField && nextMissingField === null) {
          const alreadyBooked = await getScheduledExperimentalClassBookingWhatsApp({ admin, leadId });
          if (alreadyBooked?.id) {
            return Response.json({ ok: true, handled: true, flow: "whatsapp_already_booked" });
          }
          const normalizedInbound = String(inboundContent ?? "").trim();
          const looksLikeDateOrTime = /\d/.test(normalizedInbound) || /hoje|amanha|amanhã|segunda|terca|quarta|quinta|sexta|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(normalizedInbound);
          const lastAskedAboutSchedule = Boolean(
            lastBotText && (
              /qual (dia|data|horário|hora|horario)/i.test(lastBotText) ||
              lastBotText.startsWith("Datas disponíveis") ||
              lastBotText.startsWith("As datas disponíveis são:") ||
              lastBotText.startsWith("Dias disponíveis") ||
              lastBotText.startsWith("Os dias disponíveis são:") ||
              lastBotText.startsWith("Horários disponíveis") ||
              lastBotText.startsWith("Os horários disponíveis são:") ||
              lastBotText.startsWith("Responda apenas com o dia desejado") ||
              lastBotText.startsWith("Responda apenas com o horário desejado")
            )
          );
          if (hasReachedPostCityStage && !looksLikeDateOrTime && !lastAskedAboutSchedule) {
            return Response.json({
              ok: true,
              ignored: true,
              reason: "quiet_no_schedule_question_received_non_date_input",
            });
          }
          const leadTz =
            String((lead as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
          const { messages: fallbackDateMessages } = await presentExperimentalClassDateOptionsWhatsApp({
            admin,
            leadId,
            conversationId,
            leadTimeZone: leadTz,
          });
          for (const dateMsg of fallbackDateMessages) {
            const cleanMsg = String(dateMsg ?? "").trim();
            if (!cleanMsg) continue;
            try {
              await sendAtendimentoWhatsAppText({ phone: normalizedPhoneOnly, message: cleanMsg });
            } catch (_e) {}
          }
          return Response.json({ ok: true, handled: true, flow: "whatsapp_date_presented_fallback" });
        }

        if (expectedField === "date") {
          const leadTz =
            String((lead as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
          const { availability } = await presentExperimentalClassDateOptionsWhatsApp({
            admin,
            leadId,
            conversationId,
            leadTimeZone: leadTz,
          });
          const chosen = findExperimentalClassDateOption(inboundContent, availability.dates);
          if (!chosen) {
            const nextFail =
              (await countWhatsAppScheduleFailures({ admin, leadId, conversationId, field: "date" })) +
              1;
            const blocked = nextFail >= MAX_SCHEDULE_WHATSAPP_ATTEMPTS;

            void appendHistoryEvent({
              leadId,
              conversationId,
              eventType: "experimental_class_date_validation_failed",
              title: "Falha ao identificar dia da aula experimental via WhatsApp",
              details: {
                attempt: nextFail,
                content_text: inboundContent || null,
                blocked,
              },
              actorType: "system",
            });

            if (blocked) {
              await sendSupportFinalAndMarkBlocked({
                admin,
                leadId,
                conversationId,
                normalizedPhoneOnly,
                blockedStage: "date",
                attempt: nextFail,
                contentText: inboundContent,
              });
              return Response.json({
                ok: true,
                handled: true,
                flow: "whatsapp_date_blocked_support",
                blocked: true,
              });
            }

            const msg = `${EXPERIMENTAL_CLASS_DATE_INVALID_MESSAGE}\n\nTentativa ${nextFail} de ${MAX_SCHEDULE_WHATSAPP_ATTEMPTS}.`;
            await insertWhatsAppBotTextMessage({ admin, conversationId, contentText: msg });
            try {
              await sendAtendimentoWhatsAppText({ phone: normalizedPhoneOnly, message: msg });
            } catch (_e) {}
            return Response.json({
              ok: true,
              handled: true,
              flow: "whatsapp_date_retry",
              blocked: false,
            });
          }

          void appendHistoryEvent({
            leadId,
            conversationId,
            eventType: "experimental_class_date_selected",
            title: "Data da aula experimental selecionada via WhatsApp",
            details: {
              professor_date: chosen.professorDate,
              lead_date: chosen.leadDate,
              label: chosen.displayLabel,
            },
            actorType: "system",
          });

          try {
            await admin
              .from("atendimento_leads")
              .update({
                experimental_class_professor_date: chosen.professorDate,
                experimental_class_lead_date: chosen.leadDate,
                experimental_class_status: "date_selected",
                updated_at: nowIso,
              })
              .eq("id", leadId);
          } catch (_e) {
            try {
              await admin
                .from("atendimento_leads")
                .update({ updated_at: nowIso })
                .eq("id", leadId);
            } catch (_e2) {}
          }

          const pres = await presentExperimentalClassTimeOptionsWhatsApp({
            admin,
            leadId,
            conversationId,
            leadTimeZone: leadTz,
            professorDate: chosen.professorDate,
          });
          for (const timeMsg of pres.messages) {
            const cleanMsg = String(timeMsg ?? "").trim();
            if (!cleanMsg) continue;
            try {
              await sendAtendimentoWhatsAppText({ phone: normalizedPhoneOnly, message: cleanMsg });
            } catch (_e) {}
          }
          return Response.json({ ok: true, handled: true, flow: "whatsapp_time_presented" });
        }

        if (expectedField === "time") {
          const leadTz =
            String((lead as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
          const { data: latestTimeEvt } = await admin
            .from("atendimento_history_events")
            .select("details")
            .eq("lead_id", leadId)
            .eq("conversation_id", conversationId)
            .eq("event_type", "experimental_class_time_options_presented")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const professorDate = String(
            (((latestTimeEvt as any)?.details ?? {}) as Record<string, unknown>).professor_date ?? "",
          ).trim();
          if (!professorDate) {
            const fallback = await presentExperimentalClassDateOptionsWhatsApp({
              admin,
              leadId,
              conversationId,
              leadTimeZone: leadTz,
            });
            for (const dateMsg of fallback.messages) {
              const cleanMsg = String(dateMsg ?? "").trim();
              if (!cleanMsg) continue;
              try {
                await sendAtendimentoWhatsAppText({ phone: normalizedPhoneOnly, message: cleanMsg });
              } catch (_e) {}
            }
            return Response.json({ ok: true, handled: true, flow: "whatsapp_date_represented" });
          }
          const pres = await presentExperimentalClassTimeOptionsWhatsApp({
            admin,
            leadId,
            conversationId,
            leadTimeZone: leadTz,
            professorDate,
          });
          const chosen = findExperimentalClassTimeOption(inboundContent, pres.slots);
          if (!chosen) {
            const nextFail =
              (await countWhatsAppScheduleFailures({ admin, leadId, conversationId, field: "time" })) +
              1;
            const blocked = nextFail >= MAX_SCHEDULE_WHATSAPP_ATTEMPTS;

            void appendHistoryEvent({
              leadId,
              conversationId,
              eventType: "experimental_class_time_validation_failed",
              title: "Falha ao identificar horário da aula experimental via WhatsApp",
              details: {
                attempt: nextFail,
                content_text: inboundContent || null,
                blocked,
                professor_date: professorDate || null,
              },
              actorType: "system",
            });

            if (blocked) {
              await sendSupportFinalAndMarkBlocked({
                admin,
                leadId,
                conversationId,
                normalizedPhoneOnly,
                blockedStage: "time",
                attempt: nextFail,
                contentText: inboundContent,
              });
              return Response.json({
                ok: true,
                handled: true,
                flow: "whatsapp_time_blocked_support",
                blocked: true,
              });
            }

            const msg = `${EXPERIMENTAL_CLASS_TIME_INVALID_MESSAGE}\n\nTentativa ${nextFail} de ${MAX_SCHEDULE_WHATSAPP_ATTEMPTS}.`;
            await insertWhatsAppBotTextMessage({ admin, conversationId, contentText: msg });
            try {
              await sendAtendimentoWhatsAppText({ phone: normalizedPhoneOnly, message: msg });
            } catch (_e) {}
            return Response.json({
              ok: true,
              handled: true,
              flow: "whatsapp_time_retry",
              blocked: false,
            });
          }

          void appendHistoryEvent({
            leadId,
            conversationId,
            eventType: "experimental_class_time_selected",
            title: "Horário da aula experimental selecionado via WhatsApp",
            details: {
              professor_date: chosen.professorDate,
              professor_time: chosen.professorTime,
              professor_start_at: chosen.professorStartAt,
              lead_date: chosen.leadDate,
              lead_time: chosen.leadTime,
              label: chosen.displayLabel,
            },
            actorType: "system",
          });

          try {
            await admin
              .from("atendimento_leads")
              .update({
                experimental_class_professor_date: chosen.professorDate,
                experimental_class_lead_date: chosen.leadDate,
                experimental_class_professor_time: chosen.professorTime,
                experimental_class_lead_time: chosen.leadTime,
                experimental_class_professor_start_at: chosen.professorStartAt,
                experimental_class_lead_start_at: chosen.professorStartAt,
                experimental_class_status: "time_selected",
                updated_at: nowIso,
              })
              .eq("id", leadId);
          } catch (_e) {
            try {
              await admin
                .from("atendimento_leads")
                .update({ updated_at: nowIso })
                .eq("id", leadId);
            } catch (_e2) {}
          }

          const already = await getScheduledExperimentalClassBookingWhatsApp({ admin, leadId });
          if (!already?.id) {
            const { data: booking } = await admin
              .from("atendimento_experimental_class_bookings")
              .insert({
                lead_id: leadId,
                conversation_id: conversationId,
                professor_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
                lead_timezone: leadTz,
                professor_date: chosen.professorDate,
                professor_time: chosen.professorTime,
                professor_start_at: chosen.professorStartAt,
                lead_date: chosen.leadDate,
                lead_time: chosen.leadTime,
                lead_start_at: chosen.professorStartAt,
                status: "scheduled",
              })
              .select("*")
              .maybeSingle();

            try {
              await admin
                .from("atendimento_leads")
                .update({
                  funnel_stage: "aula_experimental_agendada",
                  status: "em_atendimento",
                  best_contact_time: chosen.leadTime,
                  updated_at: nowIso,
                })
                .eq("id", leadId);
            } catch (_e) {}

            try {
              await admin
                .from("atendimento_conversations")
                .update({
                  bot_enabled: false,
                  updated_at: nowIso,
                })
                .eq("id", conversationId);
            } catch (_e) {}

            try {
              await appendHistoryEvent({
                leadId,
                conversationId,
                eventType: "experimental_class_scheduled",
                title: "Aula experimental agendada via WhatsApp",
                details: {
                  booking_id: String((booking as any)?.id ?? ""),
                  teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
                  lead_timezone: leadTz,
                  professor_date: chosen.professorDate,
                  professor_time: chosen.professorTime,
                  professor_start_at: chosen.professorStartAt,
                  lead_date: chosen.leadDate,
                  lead_time: chosen.leadTime,
                },
                actorType: "system",
              });
            } catch (_e) {}

            try {
              await appendHistoryEvent({
                leadId,
                conversationId,
                eventType: "whatsapp_flow_concluded_bot_disabled",
                title: "Fluxo WhatsApp de agendamento concluido — bot desativado para novos disparos",
                details: {
                  reason: "aula_experimental_agendada",
                  disabled_at: nowIso,
                },
                actorType: "system",
              });
            } catch (_e) {}

            const firstName =
              String((lead as any)?.full_name ?? "").trim().split(/\s+/)[0] || "Aluno";
            const chatMsgs = buildExperimentalClassBookingChatMessages(firstName);
            for (const m of chatMsgs) {
              await insertWhatsAppBotTextMessage({ admin, conversationId, contentText: m });
            }
            try {
              for (const m of buildExperimentalClassStudentWhatsAppMessages(firstName)) {
                await sendAtendimentoWhatsAppText({
                  phone: normalizedPhoneOnly,
                  message: m,
                });
              }
            } catch (_e) {}
            try {
              await sendAtendimentoWhatsAppText({
                phone: EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
                message: buildExperimentalClassAttendantWhatsAppMessage(),
              });
            } catch (_e) {}
          }

          return Response.json({
            ok: true,
            handled: true,
            flow: "whatsapp_booked",
          });
        }

        if (hasReachedPostCityStage && !isFirstBotInteraction) {
          return Response.json({
            ok: true,
            ignored: true,
            reason: "flow_inattended_or_waiting_human_stage_quiet",
            last_expected: expectedField,
            next_missing: nextMissingField ?? null,
          });
        }
      }
    } catch (_whatsappLeadErr) {
      const errMsg = String((_whatsappLeadErr as any)?.message ?? String(_whatsappLeadErr ?? "")).trim() || "unknown";
      try {
        await admin.from("logs").insert({
          user_id: userId,
          tipo: "zapi_erro_fluxo_atendimento",
          descricao: `Erro ao processar lead/conversa WhatsApp (engolido antes, agora logado). Telefone: ${normalizedPhoneOnly || normalizedFrom || "-"}. Erro: ${errMsg.slice(0, 800)}`,
        });
      } catch (_logErr) {}
      return Response.json(
        { ok: false, error: errMsg, ignored: true, reason: "whatsapp_lead_processing_exception", phone: normalizedPhoneOnly || null },
        { status: 500 },
      );
    }
  }

  if (!normalizedFrom) {
    await admin.from("logs").insert({
      user_id: userId,
      tipo: "zapi_webhook_ignorado",
      descricao: "Webhook ignorado: remetente sem telefone identificável.",
    });
    return Response.json({ ok: true, ignored: true, reason: "missing_sender_phone" });
  }

  const { data: debtors } = await admin
    .from("debtors")
    .select("id, telefone")
    .eq("user_id", userId)
    .limit(500);

  const match = (debtors ?? []).find((d: any) => normalizePhone(String(d?.telefone ?? "")) === normalizedFrom);
  const debtorId = match?.id ? String(match.id) : null;
  if (!debtorId) {
    await admin.from("logs").insert({
      user_id: userId,
      tipo: "zapi_webhook_ignorado",
      descricao: `Webhook ignorado: telefone ${normalizedFrom} sem lead de atendimento e sem cliente cadastrado no financeiro.`,
    });
    return Response.json({ ok: true, ignored: true, reason: "unknown_debtor_or_lead" });
  }

  const { data: activeSchedule } = await admin
    .from("schedules")
    .select("id, status")
    .eq("user_id", userId)
    .eq("debtor_id", debtorId)
    .in("status", ["pendente", "atrasado"])
    .order("data_envio", { ascending: true })
    .limit(1)
    .maybeSingle();

  const scheduleId = activeSchedule?.id ? String(activeSchedule.id) : null;
  if (!scheduleId) {
    await admin.from("logs").insert({
      user_id: userId,
      tipo: "zapi_webhook_ignorado",
      descricao: `Webhook financeiro ignorado: cliente ${debtorId} sem cobrança pendente/atrasada.`,
    });
    return Response.json({ ok: true, ignored: true, reason: "no_open_charge" });
  }

  const analysis =
    (await analyzePayment({ text: messageText, mediaUrl: mediaUrl || null }).catch((e: any) => ({
      ok: false as const,
      error: String(e?.message ?? "Falha ao analisar"),
    }))) || { ok: false as const, error: "Falha ao analisar" };

  const fallbackRes = analysis.ok
    ? null
    : heuristicPaymentDetection({
        text: messageText,
        mediaUrl: mediaUrl || null,
        hasPaymentMedia: mediaInfo.hasPaymentMedia,
      });
  if (!analysis.ok && (!fallbackRes || !fallbackRes.ok)) {
    return Response.json({ ok: true, analyzed: false, error: analysis.error });
  }

  const fallbackResult = fallbackRes && fallbackRes.ok ? fallbackRes.result : null;
  const finalResult = analysis.ok
    ? analysis.result
    : {
        is_payment_proof: true,
        confidence: fallbackResult?.confidence ?? 0,
        reason: fallbackResult?.reason ?? "",
        extracted: null,
        raw: fallbackResult?.raw ?? null,
      };

  const shouldCreate = finalResult.is_payment_proof && finalResult.confidence >= 0.75;
  if (!shouldCreate) {
    return Response.json({
      ok: true,
      analyzed: true,
      created: false,
      confidence: finalResult.confidence,
    });
  }

  const nowIso = new Date().toISOString();

  if (scheduleId) {
    const paymentRes = await confirmExecutedSchedulePaymentForUser({ scheduleId, userId });
    if (!paymentRes.ok) {
      return Response.json(
        { ok: false, error: paymentRes.error ?? "Falha ao confirmar pagamento." },
        { status: 500 },
      );
    }

    await admin.from("payment_suspicions").upsert(
      {
        user_id: userId,
        schedule_id: scheduleId,
        debtor_id: debtorId,
        provider: "zapi",
        event_id: eventId,
        from_phone: normalizedFrom || fromPhone || null,
        message_text: messageText || null,
        media_url: mediaUrl || null,
        ai_confidence: finalResult.confidence,
        ai_reason: finalResult.reason || null,
        ai_result: finalResult.raw,
        status: "confirmed",
        resolved_at: nowIso,
      },
      { onConflict: "provider,event_id" },
    );

    await admin.from("logs").insert({
      user_id: userId,
      tipo: "pagamento_confirmado",
      descricao: `Pagamento confirmado automaticamente para o agendamento ${scheduleId}`,
    });

    return Response.json({ ok: true, analyzed: true, created: true, scheduleId, confirmed: true });
  }

  await admin.from("payment_suspicions").upsert(
    {
      user_id: userId,
      schedule_id: scheduleId,
      debtor_id: debtorId,
      provider: "zapi",
      event_id: eventId,
      from_phone: normalizedFrom || fromPhone || null,
      message_text: messageText || null,
      media_url: mediaUrl || null,
      ai_confidence: finalResult.confidence,
      ai_reason: finalResult.reason || null,
      ai_result: finalResult.raw,
      status: "pending",
    },
    { onConflict: "provider,event_id" },
  );

  await admin.from("logs").insert({
    user_id: userId,
    tipo: "pagamento_suspeito",
    descricao: "Suspeita de pagamento detectada (sem agendamento associado)",
  });

  return Response.json({ ok: true, analyzed: true, created: true, scheduleId });
}
