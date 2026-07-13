import {
  botReplyForLead,
  extractLeadDataFromMessage,
  fieldFromBotPrompt,
  filterCapturedDataForLead,
  getNextMissingField,
} from "@/lib/atendimento/bot";
import {
  ATENDIMENTO_BLOCKED_FINAL_MESSAGE,
  ATENDIMENTO_PROFESSOR_TIME_ZONE,
  buildExperimentalClassDatePromptMessages,
  EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE,
  LOCATION_CITY_BLOCKED_FINAL_MESSAGE,
  LOCATION_CITY_INVALID_MESSAGE,
  LOCATION_STATE_BLOCKED_FINAL_MESSAGE,
  LOCATION_STATE_INVALID_MESSAGE,
  NUMERIC_ONLY_FIELDS,
} from "@/lib/atendimento/constants";
import {
  buildExperimentalClassDatesMessages,
  buildExperimentalClassFinalChatMessage,
  buildExperimentalClassStudentWhatsAppMessage,
  buildExperimentalClassTimesMessage,
  EXPERIMENTAL_CLASS_BOOKING_SUCCESS_MESSAGE,
  EXPERIMENTAL_CLASS_DURATION_MINUTES,
  EXPERIMENTAL_CLASS_WHATSAPP_NOTICE_MESSAGE,
  findExperimentalClassDateOption,
  findExperimentalClassTimeOption,
  listExperimentalClassAvailability,
} from "@/lib/atendimento/experimentalClass";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  appendHistoryEvent,
  ensureInitialBotConversationFlow,
  getAuthenticatedAtendimentoConversationAccess,
  sendAtendimentoWhatsAppText,
  syncConversationPreview,
} from "@/lib/atendimento/server";
import { getAtendimentoConversationPreviewText } from "@/lib/atendimento/files";
import { resolveBaseUrlFromHeaders } from "@/lib/site-url";
import type { CapturedFieldName } from "@/lib/atendimento/types";
import { resolveTimeZoneFromCityInput, resolveTimeZoneFromStateInput } from "@/lib/timezone";

const POST_LEAD_REPLY_DELAY_MS = 2500;
const MAX_PHONE_FORMAT_ATTEMPTS = 3;
const MAX_LOCATION_VALIDATION_ATTEMPTS = 3;
const WHATSAPP_PENDING_MESSAGE =
  "Perfeito! Estou validando seu WhatsApp. Aguarde um instante.";
const WHATSAPP_INVALID_MESSAGE =
  "Não foi possível validar esse número de WhatsApp. Por favor, informe um WhatsApp válido com o código do país no início (+55 para Brasil ou +1 para Estados Unidos).";
const WHATSAPP_INVALID_FORMAT_MESSAGE =
  "O número informado é inválido. Informe um WhatsApp válido com o código do país no início (+55 para Brasil ou +1 para Estados Unidos).";
const WHATSAPP_INVALID_FORMAT_FINAL_MESSAGE = ATENDIMENTO_BLOCKED_FINAL_MESSAGE;
const NUMERIC_ONLY_TEXT_MESSAGE =
  "Essa resposta não me parece válida. Responda somente com números.";
const NUMERIC_ONLY_MIXED_MESSAGE =
  "Por favor, responda somente com números.";
const PHONE_CONFIRMATION_PROMPT_MESSAGE =
  'Para continuarmos, confirme se o número informado acima está correto respondendo "sim". Caso contrário, envie apenas o número correto para prosseguirmos.';
const PHONE_CONFIRMATION_SEND_FAILED_MESSAGE =
  "Ops! Parece que ocorreu uma falha em nosso sistema.\n\nEntre em contato conosco pelo link abaixo para que nossa equipe possa ajuda-lo:\n\nhttps://wa.me/5565996933336";

function firstNameFromLead(lead: { full_name?: string | null }) {
  const clean = String(lead.full_name ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.split(" ")[0] ?? "";
}

function buildWhatsAppWelcomeMessage(lead: { full_name?: string | null }) {
  const firstName = firstNameFromLead(lead) || "aluno(a)";
  return `Olá, ${firstName}! 👋

Seja muito bem-vindo(a) ao Lucas Brum Online Music USA!

Estamos felizes em ter você conosco.

Conclua as etapas do AutoBot para agendar sua aula experimental. No dia e horário escolhidos, entraremos em contato.

Nos vemos em breve ${firstName}. 🤝`;
}

function extractWhatsAppMessageIds(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return { messageId: null, zaapId: null };
  }
  const data = payload as Record<string, unknown>;
  return {
    messageId: String(data.messageId ?? data.id ?? "").trim() || null,
    zaapId: String(data.zaapId ?? "").trim() || null,
  };
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isNumericOnlyField(field: CapturedFieldName | null): field is CapturedFieldName {
  return Boolean(field && (NUMERIC_ONLY_FIELDS as readonly string[]).includes(field));
}

function classifyNumericOnlyResponse(value: string) {
  const raw = String(value ?? "").trim();
  const hasDigits = /\d/.test(raw);
  const hasLetters = /[A-Za-zÀ-ÿ]/.test(raw);

  if (hasLetters && !hasDigits) {
    return {
      ok: false as const,
      reason: "text_only" as const,
      message: NUMERIC_ONLY_TEXT_MESSAGE,
    };
  }

  if (hasLetters && hasDigits) {
    return {
      ok: false as const,
      reason: "mixed" as const,
      message: NUMERIC_ONLY_MIXED_MESSAGE,
    };
  }

  if (!hasDigits) {
    return {
      ok: false as const,
      reason: "text_only" as const,
      message: NUMERIC_ONLY_TEXT_MESSAGE,
    };
  }

  return {
    ok: true as const,
  };
}

function normalizeDecisionText(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function interpretPhoneConfirmationDecision(value: string) {
  const normalized = normalizeDecisionText(value);
  if (!normalized) return "unknown" as const;
  if (/\bnao\b/.test(normalized)) return "negative" as const;
  if (/\bsim\b/.test(normalized)) return "positive" as const;
  if (
    /\b(pode|podemos)\s+(seguir|prosseguir|validar|fazer)\b/.test(normalized) ||
    /\b(confirmo|confirmado|afirmativo|claro|perfeito|correto)\b/.test(normalized) ||
    /\b(tenho\s+certeza|esta\s+certo|esta\s+correto|numero\s+certo|numero\s+correto)\b/.test(normalized)
  ) {
    return "positive" as const;
  }
  return "unknown" as const;
}

async function getPendingPhoneConfirmation(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
}) {
  const { data } = await params.admin
    .from("atendimento_history_events")
    .select("id, details")
    .eq("lead_id", params.leadId)
    .eq("conversation_id", params.conversationId)
    .eq("event_type", "phone_confirmation_pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as { id: string; details: Record<string, unknown> | null } | null;
}

function inferExpectedFieldFromBotMessage(promptText: unknown): CapturedFieldName | null {
  const raw = String(promptText ?? "").trim();
  if (!raw) return null;
  const mapped = fieldFromBotPrompt(raw);
  if (mapped) return mapped;
  if (raw.startsWith(LOCATION_STATE_INVALID_MESSAGE)) {
    return "state";
  }
  if (raw.startsWith(LOCATION_CITY_INVALID_MESSAGE)) {
    return "city";
  }
  if (
    raw.startsWith(WHATSAPP_INVALID_MESSAGE) ||
    raw.startsWith(WHATSAPP_INVALID_FORMAT_MESSAGE) ||
    raw === NUMERIC_ONLY_TEXT_MESSAGE ||
    raw === NUMERIC_ONLY_MIXED_MESSAGE ||
    raw === WHATSAPP_PENDING_MESSAGE
  ) {
    return "phone";
  }
  return null;
}

function hasSupportedWhatsAppCountryCode(value: string) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return false;
  if (raw.startsWith("+55") || raw.startsWith("55")) return true;
  if (raw.startsWith("+1") || raw.startsWith("1")) return true;
  return false;
}

function extractReplacementPhoneFromConfirmationResponse(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/[A-Za-zÀ-ÿ]/.test(raw)) return null;
  if (!/^[+\d()\s-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (!hasSupportedWhatsAppCountryCode(raw)) return null;
  return raw;
}

async function getPhoneFormatFailureCount(params: {
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

function buildPhoneValidationRetryMessage(attempts: number) {
  return `${WHATSAPP_INVALID_MESSAGE}\n\nTentativa ${attempts} de ${MAX_PHONE_FORMAT_ATTEMPTS}.`;
}

function buildPhoneFormatRetryMessage(attempts: number) {
  return `${WHATSAPP_INVALID_FORMAT_MESSAGE}\n\nTentativa ${attempts} de ${MAX_PHONE_FORMAT_ATTEMPTS}.`;
}

function buildLocationRetryMessage(field: "state" | "city", attempts: number) {
  const baseMessage = field === "state" ? LOCATION_STATE_INVALID_MESSAGE : LOCATION_CITY_INVALID_MESSAGE;
  return `${baseMessage}\n\nTentativa ${attempts} de ${MAX_LOCATION_VALIDATION_ATTEMPTS}.`;
}

function getLocationBlockedFinalMessage(field: "state" | "city") {
  return field === "state" ? LOCATION_STATE_BLOCKED_FINAL_MESSAGE : LOCATION_CITY_BLOCKED_FINAL_MESSAGE;
}

function getLocationFailureEventType(field: "state" | "city") {
  return field === "state" ? "state_validation_failed" : "city_validation_failed";
}

async function getLocationValidationFailureCount(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
  field: "state" | "city";
}) {
  const { count } = await params.admin
    .from("atendimento_history_events")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", params.leadId)
    .eq("conversation_id", params.conversationId)
    .eq("event_type", getLocationFailureEventType(params.field));

  return Number(count ?? 0);
}

function looksLikeFieldValue(field: CapturedFieldName, text: string) {
  const clean = text.trim();
  if (!clean) return false;
  if (field === "phone") return clean.replace(/\D/g, "").length >= 8;
  if (field === "full_name") return clean.split(/\s+/).length >= 2;
  return true;
}

function buildLeadLocationContext(params: {
  captured: Record<string, string>;
  leadState?: string | null;
  phone?: string | null;
}) {
  const state = String(params.captured.state ?? params.leadState ?? "").trim();
  const city = String(params.captured.city ?? "").trim();
  if (!city) {
    const normalizedState = state.replace(/\s+/g, " ").trim();
    return {
      leadPatch: {
        ...params.captured,
        ...(normalizedState ? { state: normalizedState } : {}),
      },
      capturedFieldValues: {
        ...params.captured,
        ...(normalizedState ? { state: normalizedState } : {}),
      },
      historyDetails: null as Record<string, unknown> | null,
    };
  }

  const resolved = resolveTimeZoneFromCityInput({
    city,
    state,
    phone: params.phone,
    allowPhoneCountryFallback: false,
  });

  if (!resolved) {
    return {
      leadPatch: params.captured,
      capturedFieldValues: params.captured,
      historyDetails: null as Record<string, unknown> | null,
    };
  }

  const normalizedCity = resolved.city;
  const normalizedState = resolved.state ?? (state.replace(/\s+/g, " ").trim() || null);
  const country = resolved.country === "BR" ? "Brasil" : resolved.country === "US" ? "Estados Unidos" : null;
  const leadPatch = {
    ...params.captured,
    ...(normalizedState ? { state: normalizedState } : {}),
    city: normalizedCity,
    timezone: resolved.timeZone,
    ...(country ? { country } : {}),
  };

  return {
    leadPatch,
    capturedFieldValues: {
      ...params.captured,
      ...(normalizedState ? { state: normalizedState } : {}),
      city: normalizedCity,
      timezone: resolved.timeZone,
      ...(country ? { country } : {}),
    },
    historyDetails: {
      state: normalizedState,
      city: normalizedCity,
      timezone: resolved.timeZone,
      teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
      country,
      source: resolved.source,
    } satisfies Record<string, unknown>,
  };
}

async function upsertCapturedFields(params: {
  leadId: string;
  sourceMessageId: string;
  values: Record<string, string>;
}) {
  const admin = createSupabaseAdminClient();
  const entries = Object.entries(params.values).filter(([, value]) => String(value).trim());
  if (!entries.length) return;

  for (const [fieldName, fieldValue] of entries) {
    const { data: existing } = await admin
      .from("atendimento_captured_fields")
      .select("id")
      .eq("lead_id", params.leadId)
      .eq("field_name", fieldName)
      .maybeSingle();

    if (existing?.id) {
      await admin
        .from("atendimento_captured_fields")
        .update({
          field_value: fieldValue,
          source_message_id: params.sourceMessageId,
          confidence: 0.92,
          updated_at: new Date().toISOString(),
        })
        .eq("id", String(existing.id));
    } else {
      await admin.from("atendimento_captured_fields").insert({
        lead_id: params.leadId,
        field_name: fieldName,
        field_value: fieldValue,
        source_message_id: params.sourceMessageId,
        confidence: 0.92,
      });
    }
  }
}

async function insertBotTextMessage(params: {
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
      throw new Error(error.message || "Falha ao enviar mensagem automática do bot.");
    }
  }

  return (data as Record<string, unknown> | null) ?? null;
}

function isExperimentalClassBookingsTableUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .*atendimento_experimental_class_bookings.*does not exist/i.test(message) ||
    /could not find the table .*atendimento_experimental_class_bookings.* in the schema cache/i.test(message)
  );
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

  const tableMissing = Boolean(error) && isExperimentalClassBookingsTableUnavailable(error);
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

async function getScheduledExperimentalClassBooking(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
}) {
  const { data, error } = await params.admin
    .from("atendimento_experimental_class_bookings")
    .select("*")
    .eq("lead_id", params.leadId)
    .eq("status", "scheduled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tableMissing = Boolean(error) && isExperimentalClassBookingsTableUnavailable(error);
  if (error && !tableMissing) {
    throw new Error(error.message || "Falha ao consultar o agendamento da aula experimental.");
  }

  if (data) {
    return data as Record<string, unknown> | null;
  }

  const { data: fallbackData, error: fallbackError } = await params.admin
    .from("atendimento_history_events")
    .select("id, details, created_at")
    .eq("lead_id", params.leadId)
    .eq("event_type", "experimental_class_scheduled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fallbackError) {
    throw new Error(fallbackError.message || "Falha ao consultar o agendamento da aula experimental.");
  }

  return fallbackData
    ? {
        id: String((fallbackData as any).id ?? ""),
        professor_start_at: String((((fallbackData as any).details ?? {}) as Record<string, unknown>).professor_start_at ?? ""),
      }
    : null;
}

async function reserveExperimentalClassSlot(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
  leadTimeZone: string;
  selectedTimeOption: {
    professorDate: string;
    professorTime: string;
    professorStartAt: string;
    leadDate: string;
    leadTime: string;
  };
}) {
  const { data, error } = await params.admin
    .from("atendimento_experimental_class_bookings")
    .insert({
      lead_id: params.leadId,
      conversation_id: params.conversationId,
      professor_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
      lead_timezone: params.leadTimeZone,
      professor_date: params.selectedTimeOption.professorDate,
      professor_time: params.selectedTimeOption.professorTime,
      professor_start_at: params.selectedTimeOption.professorStartAt,
      lead_date: params.selectedTimeOption.leadDate,
      lead_time: params.selectedTimeOption.leadTime,
      lead_start_at: params.selectedTimeOption.professorStartAt,
      status: "scheduled",
    })
    .select("*")
    .maybeSingle();

  if (!error) {
    return {
      ok: true as const,
      conflict: false as const,
      booking: (data as Record<string, unknown> | null) ?? null,
    };
  }

  const code = String((error as any)?.code ?? "").trim();
  if (code === "23505") {
    return {
      ok: true as const,
      conflict: true as const,
      booking: null,
    };
  }

  if (!isExperimentalClassBookingsTableUnavailable(error)) {
    throw new Error(error.message || "Falha ao reservar a aula experimental.");
  }

  const bookedStarts = await listScheduledExperimentalClassProfessorStarts({
    admin: params.admin,
    nowIso: new Date(0).toISOString(),
  });
  const selectedStartMs = new Date(params.selectedTimeOption.professorStartAt).getTime();
  const selectedEndMs = selectedStartMs + EXPERIMENTAL_CLASS_DURATION_MINUTES * 60 * 1000;
  const hasConflict = bookedStarts.some((bookedStart) => {
    const bookedStartMs = new Date(bookedStart).getTime();
    if (!Number.isFinite(bookedStartMs)) return false;
    const bookedEndMs = bookedStartMs + EXPERIMENTAL_CLASS_DURATION_MINUTES * 60 * 1000;
    return selectedStartMs < bookedEndMs && bookedStartMs < selectedEndMs;
  });

  if (hasConflict) {
    return {
      ok: true as const,
      conflict: true as const,
      booking: null,
    };
  }

  return {
    ok: true as const,
    conflict: false as const,
    booking: null,
  };
}

async function getLatestHistoryEventByType(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
  eventType: string;
}) {
  const { data, error } = await params.admin
    .from("atendimento_history_events")
    .select("id, details, created_at")
    .eq("lead_id", params.leadId)
    .eq("conversation_id", params.conversationId)
    .eq("event_type", params.eventType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Falha ao consultar o histórico do agendamento.");
  }

  return data as { id: string; details: Record<string, unknown> | null; created_at: string } | null;
}

async function presentExperimentalClassDateOptions(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
  leadTimeZone?: string | null;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const bookedStarts = await listScheduledExperimentalClassProfessorStarts({
    admin: params.admin,
    nowIso: now.toISOString(),
  });
  const availability = listExperimentalClassAvailability({
    now,
    leadTimeZone: params.leadTimeZone,
    bookedProfessorStartAts: bookedStarts,
  });
  const messages = buildExperimentalClassDatesMessages(availability.dates);
  let outbound: Record<string, unknown> | null = null;
  for (const message of messages) {
    outbound = await insertBotTextMessage({
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
    createdAt: String(outbound?.created_at ?? new Date().toISOString()),
  });

  return {
    outbound,
    availability,
    message: messages[messages.length - 1] ?? "",
  };
}

async function presentExperimentalClassTimeOptions(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string;
  leadTimeZone?: string | null;
  professorDate: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const bookedStarts = await listScheduledExperimentalClassProfessorStarts({
    admin: params.admin,
    nowIso: now.toISOString(),
  });
  const availability = listExperimentalClassAvailability({
    now,
    leadTimeZone: params.leadTimeZone,
    bookedProfessorStartAts: bookedStarts,
  });
  const dateOption = availability.dates.find((option) => option.professorDate === params.professorDate) ?? null;
  const timeOptions = availability.slotsByProfessorDate.get(params.professorDate) ?? [];
  const message = buildExperimentalClassTimesMessage({
    dayLabel: dateOption?.dayLabel ?? params.professorDate.slice(8, 10),
    options: timeOptions,
  });
  const outbound = await insertBotTextMessage({
    admin: params.admin,
    conversationId: params.conversationId,
    contentText: message,
  });

  await appendHistoryEvent({
    leadId: params.leadId,
    conversationId: params.conversationId,
    eventType: "experimental_class_time_options_presented",
    title: "Horários disponíveis da aula experimental apresentados",
    details: {
      teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
      lead_timezone: String(params.leadTimeZone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
      professor_date: params.professorDate,
      date_label: dateOption?.displayLabel ?? params.professorDate,
      day_label: dateOption?.dayLabel ?? params.professorDate.slice(8, 10),
      options: timeOptions,
    },
    actorType: "system",
  });

  await syncConversationPreview({
    conversationId: params.conversationId,
    contentText: message,
    createdAt: String(outbound?.created_at ?? new Date().toISOString()),
  });

  return {
    outbound,
    dateOption,
    timeOptions,
    message,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const publicSlug = String(searchParams.get("public_slug") ?? "").trim();
  if (!publicSlug) {
    return Response.json({ ok: false, error: "missing_public_slug" }, { status: 400 });
  }

  const access = await getAuthenticatedAtendimentoConversationAccess(publicSlug);
  if (!access.ok) {
    return Response.json({ ok: false, error: access.error }, { status: access.status });
  }
  const { admin, conversation } = access;

  await ensureInitialBotConversationFlow({
    leadId: String(conversation.lead_id),
    conversationId: String(conversation.id),
  });

  const { data, error } = await admin
    .from("atendimento_messages")
    .select("*")
    .eq("conversation_id", String(conversation.id))
    .order("created_at", { ascending: true });

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  await admin
    .from("atendimento_messages")
    .update({ status: "lida", read_at: new Date().toISOString() })
    .eq("conversation_id", String(conversation.id))
    .in("sender_role", ["bot", "attendant"])
    .neq("status", "lida");

  return Response.json({ ok: true, messages: (data ?? []) as any[] });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const publicSlug = String(body?.public_slug ?? "").trim();
  const contentText = String(body?.content_text ?? "").trim();
  const mediaType = String(body?.media_type ?? "text").trim() || "text";
  const mediaUrl = String(body?.media_url ?? "").trim() || null;
  const mimeType = String(body?.mime_type ?? "").trim() || null;
  const fileName = String(body?.file_name ?? "").trim() || null;
  const fileSizeBytesRaw = Number(body?.file_size_bytes ?? 0);
  const fileSizeBytes = Number.isFinite(fileSizeBytesRaw) && fileSizeBytesRaw > 0 ? fileSizeBytesRaw : null;

  if (!publicSlug) {
    return Response.json({ ok: false, error: "missing_public_slug" }, { status: 400 });
  }
  if (!contentText && !mediaUrl) {
    return Response.json({ ok: false, error: "empty_message" }, { status: 400 });
  }

  const access = await getAuthenticatedAtendimentoConversationAccess(publicSlug);
  if (!access.ok) {
    return Response.json({ ok: false, error: access.error }, { status: access.status });
  }
  const { admin, conversation, lead } = access;
  if (!conversation.bot_enabled) {
    return Response.json(
      {
        ok: false,
        blocked: true,
        code: "conversation_blocked",
        error: "Este atendimento foi encerrado e não aceita novas mensagens.",
        conversation: { ...conversation, bot_enabled: false },
      },
      { status: 423 },
    );
  }

  const { data: lastBotMessage } = await admin
    .from("atendimento_messages")
    .select("content_text, created_at")
    .eq("conversation_id", String(conversation.id))
    .eq("sender_role", "bot")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nowIso = new Date().toISOString();

  const { data: lastLeadMessage } = await admin
    .from("atendimento_messages")
    .select("*")
    .eq("conversation_id", String(conversation.id))
    .eq("sender_role", "lead")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastLeadCreatedAtMs = new Date(String((lastLeadMessage as any)?.created_at ?? "")).getTime();
  const isLikelyDuplicateSubmission = Boolean(
    lastLeadMessage?.id &&
      String((lastLeadMessage as any)?.content_text ?? "").trim() === contentText &&
      String((lastLeadMessage as any)?.media_type ?? "text").trim() === mediaType &&
      String((lastLeadMessage as any)?.media_url ?? "").trim() === String(mediaUrl ?? "").trim() &&
      !Number.isNaN(lastLeadCreatedAtMs) &&
      Date.now() - lastLeadCreatedAtMs < 2500,
  );

  if (isLikelyDuplicateSubmission) {
    return Response.json({
      ok: true,
      inbound: lastLeadMessage,
      outbound: null,
      blocked: false,
      should_reload: true,
      conversation: {
        id: String(conversation.id),
        bot_enabled: true,
      },
    });
  }

  const { data: inbound, error: inboundError } = await admin
    .from("atendimento_messages")
    .insert({
      conversation_id: String(conversation.id),
      sender_role: "lead",
      content_text: contentText || null,
      media_type: mediaType,
      media_url: mediaUrl,
      mime_type: mimeType,
      file_name: fileName,
      file_size_bytes: fileSizeBytes,
      status: "recebida",
      sent_at: nowIso,
      delivered_at: nowIso,
    })
    .select("*")
    .maybeSingle();

  if (inboundError || !inbound?.id) {
    return Response.json({ ok: false, error: inboundError?.message ?? "message_error" }, { status: 500 });
  }

  const extracted = extractLeadDataFromMessage(contentText) as Record<string, string>;
  const isAwaitingPhoneConfirmation =
    String(lastBotMessage?.content_text ?? "").trim() === PHONE_CONFIRMATION_PROMPT_MESSAGE;
  const expectedField = inferExpectedFieldFromBotMessage(lastBotMessage?.content_text ?? "") ?? getNextMissingField(lead as any);
  if (
    expectedField &&
    !extracted[expectedField] &&
    !String((lead as any)?.[expectedField] ?? "").trim() &&
    looksLikeFieldValue(expectedField, contentText)
  ) {
    extracted[expectedField] = contentText.trim();
  }
  const captured = filterCapturedDataForLead({
    lead: lead as any,
    captured: extracted as any,
    expectedField,
  }) as Record<string, string>;

  const numericOnlyValidation = !isAwaitingPhoneConfirmation && isNumericOnlyField(expectedField)
    ? classifyNumericOnlyResponse(contentText)
    : null;

  if (numericOnlyValidation && !numericOnlyValidation.ok) {
    await admin
      .from("atendimento_leads")
      .update({
        unread_count: Number(lead.unread_count ?? 0) + 1,
        is_new_for_attendant: true,
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", String(lead.id));

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: getAtendimentoConversationPreviewText({ contentText, mediaType, fileName }),
      createdAt: nowIso,
    });

    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "message_received",
      title: "Mensagem recebida do lead",
      details: {
        content_text: contentText || null,
        media_type: mediaType,
        media_url: mediaUrl,
        mime_type: mimeType,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
      },
      actorType: "lead",
    });

    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "numeric_field_validation_failed",
      title: "Resposta inválida para campo numérico",
      details: {
        field: expectedField,
        reason: numericOnlyValidation.reason,
        content_text: contentText || null,
      },
      actorType: "system",
    });

    await sleep(POST_LEAD_REPLY_DELAY_MS);
    const botNowIso = new Date().toISOString();
    const { data: outbound, error: outboundError } = await admin
      .from("atendimento_messages")
      .insert({
        conversation_id: String(conversation.id),
        sender_role: "bot",
        content_text: numericOnlyValidation.message,
        media_type: "text",
        status: "entregue",
        sent_at: botNowIso,
        delivered_at: botNowIso,
      })
      .select("*")
      .maybeSingle();

    if (outboundError) {
      const code = String((outboundError as any)?.code ?? "").trim();
      if (code !== "23505") {
        return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
      }
    }

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: numericOnlyValidation.message,
      createdAt: botNowIso,
    });

    return Response.json({
      ok: true,
      inbound,
      outbound: outboundError ? null : outbound,
      blocked: false,
      conversation: {
        id: String(conversation.id),
        bot_enabled: true,
      },
    });
  }

  if (isAwaitingPhoneConfirmation) {
    const pendingPhoneConfirmation = await getPendingPhoneConfirmation({
      admin,
      leadId: String(lead.id),
      conversationId: String(conversation.id),
    });
    const decision = interpretPhoneConfirmationDecision(contentText);
    const pendingPhone = String((pendingPhoneConfirmation?.details ?? {}).phone ?? "").trim();
    const replacementPhone = extractReplacementPhoneFromConfirmationResponse(contentText);

    await admin
      .from("atendimento_leads")
      .update({
        unread_count: Number(lead.unread_count ?? 0) + 1,
        is_new_for_attendant: true,
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", String(lead.id));

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: getAtendimentoConversationPreviewText({ contentText, mediaType, fileName }),
      createdAt: nowIso,
    });

    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "message_received",
      title: "Mensagem recebida do lead",
      details: {
        content_text: contentText || null,
        media_type: mediaType,
        media_url: mediaUrl,
        mime_type: mimeType,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
      },
      actorType: "lead",
    });

    if (replacementPhone) {
      if (pendingPhoneConfirmation?.id) {
        await admin
          .from("atendimento_history_events")
          .update({
            event_type: "phone_confirmation_rejected",
            title: "Lead informou um novo número de WhatsApp para confirmação",
            details: {
              ...((pendingPhoneConfirmation.details ?? {}) as Record<string, unknown>),
              decision: "replacement_phone",
              replaced_at: nowIso,
              replacement_phone: replacementPhone,
            },
          })
          .eq("id", String(pendingPhoneConfirmation.id))
          .eq("event_type", "phone_confirmation_pending");
      }

      await appendHistoryEvent({
        leadId: String(lead.id),
        conversationId: String(conversation.id),
        eventType: "phone_confirmation_pending",
        title: "Aguardando confirmação do novo número de WhatsApp",
        details: {
          phone: replacementPhone,
          replaced_previous_phone: pendingPhone || null,
        },
        actorType: "system",
      });

      await sleep(POST_LEAD_REPLY_DELAY_MS);
      const botNowIso = new Date().toISOString();
      const { data: outbound, error: outboundError } = await admin
        .from("atendimento_messages")
        .insert({
          conversation_id: String(conversation.id),
          sender_role: "bot",
          content_text: PHONE_CONFIRMATION_PROMPT_MESSAGE,
          media_type: "text",
          status: "entregue",
          sent_at: botNowIso,
          delivered_at: botNowIso,
        })
        .select("*")
        .maybeSingle();

      if (outboundError) {
        const code = String((outboundError as any)?.code ?? "").trim();
        if (code !== "23505") {
          return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
        }
      }

      await syncConversationPreview({
        conversationId: String(conversation.id),
        contentText: PHONE_CONFIRMATION_PROMPT_MESSAGE,
        createdAt: botNowIso,
      });

      return Response.json({
        ok: true,
        inbound,
        outbound: outboundError ? null : outbound,
        blocked: false,
        conversation: {
          id: String(conversation.id),
          bot_enabled: true,
        },
      });
    }

    if (decision === "negative") {
      if (pendingPhoneConfirmation?.id) {
        await admin
          .from("atendimento_history_events")
          .update({
            event_type: "phone_confirmation_rejected",
            title: "Lead não confirmou o número de WhatsApp",
            details: {
              ...((pendingPhoneConfirmation.details ?? {}) as Record<string, unknown>),
              decision: "negative",
              rejected_at: nowIso,
            },
          })
          .eq("id", String(pendingPhoneConfirmation.id))
          .eq("event_type", "phone_confirmation_pending");
      }

      await appendHistoryEvent({
        leadId: String(lead.id),
        conversationId: String(conversation.id),
        eventType: "phone_confirmation_pending",
        title: "Aguardando confirmação do número de WhatsApp",
        details: {
          phone: pendingPhone || null,
          retried_after_negative: true,
        },
        actorType: "system",
      });

      await sleep(POST_LEAD_REPLY_DELAY_MS);
      const botNowIso = new Date().toISOString();
      const { data: outbound, error: outboundError } = await admin
        .from("atendimento_messages")
        .insert({
          conversation_id: String(conversation.id),
          sender_role: "bot",
          content_text: PHONE_CONFIRMATION_PROMPT_MESSAGE,
          media_type: "text",
          status: "entregue",
          sent_at: botNowIso,
          delivered_at: botNowIso,
        })
        .select("*")
        .maybeSingle();

      if (outboundError) {
        const code = String((outboundError as any)?.code ?? "").trim();
        if (code !== "23505") {
          return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
        }
      }

      await syncConversationPreview({
        conversationId: String(conversation.id),
        contentText: PHONE_CONFIRMATION_PROMPT_MESSAGE,
        createdAt: botNowIso,
      });

      return Response.json({
        ok: true,
        inbound,
        outbound: outboundError ? null : outbound,
        blocked: false,
        conversation: {
          id: String(conversation.id),
          bot_enabled: true,
        },
      });
    }

    if (decision === "positive") {
      const baseUrl = resolveBaseUrlFromHeaders(req.headers);
      let positiveFollowUpMessage: string | null = null;
      if (pendingPhoneConfirmation?.id) {
        await admin
          .from("atendimento_history_events")
          .update({
            event_type: "phone_confirmation_confirmed",
            title: "Lead confirmou o número de WhatsApp",
            details: {
              ...((pendingPhoneConfirmation.details ?? {}) as Record<string, unknown>),
              decision: "positive",
              confirmed_at: nowIso,
            },
          })
          .eq("id", String(pendingPhoneConfirmation.id))
          .eq("event_type", "phone_confirmation_pending");
      }

      if (pendingPhone) {
        await admin
          .from("atendimento_leads")
          .update({
            phone: pendingPhone,
            updated_at: nowIso,
          })
          .eq("id", String(lead.id));

        await upsertCapturedFields({
          leadId: String(lead.id),
          sourceMessageId: String(inbound.id),
          values: { phone: pendingPhone },
        });

        await appendHistoryEvent({
          leadId: String(lead.id),
          conversationId: String(conversation.id),
          eventType: "data_captured",
          title: "Dados capturados automaticamente",
          details: { phone: pendingPhone },
          actorType: "system",
        });

        try {
          const sendResult = await sendAtendimentoWhatsAppText({
            phone: pendingPhone,
            message: buildWhatsAppWelcomeMessage(lead as { full_name?: string | null }),
            baseUrl,
          });
          const ids = extractWhatsAppMessageIds(sendResult);
          const externalMessageId = ids.messageId ?? ids.zaapId;

          if (!externalMessageId) {
            throw new Error("Z-API não retornou identificador da mensagem para validar a entrega.");
          }

          await appendHistoryEvent({
            leadId: String(lead.id),
            conversationId: String(conversation.id),
            eventType: "phone_validation_pending",
            title: "Aguardando confirmação da entrega da mensagem no WhatsApp",
            details: {
              phone: pendingPhone,
              external_message_id: externalMessageId,
              external_zaap_id: ids.zaapId,
              payload: sendResult,
            },
            actorType: "system",
          });

          positiveFollowUpMessage = WHATSAPP_PENDING_MESSAGE;
        } catch (error) {
          await appendHistoryEvent({
            leadId: String(lead.id),
            conversationId: String(conversation.id),
            eventType: "phone_confirmation_whatsapp_send_failed",
            title: "Falha ao enviar mensagem de boas-vindas para o WhatsApp confirmado",
            details: {
              phone: pendingPhone,
              error: error instanceof Error ? error.message : String(error),
            },
            actorType: "system",
          });
          positiveFollowUpMessage = PHONE_CONFIRMATION_SEND_FAILED_MESSAGE;
        }
      }

      let outbound: Record<string, unknown> | null = null;
      if (positiveFollowUpMessage) {
        await sleep(POST_LEAD_REPLY_DELAY_MS);
        const botNowIso = new Date().toISOString();
        const { data: outboundMessage, error: outboundError } = await admin
          .from("atendimento_messages")
          .insert({
            conversation_id: String(conversation.id),
            sender_role: "bot",
            content_text: positiveFollowUpMessage,
            media_type: "text",
            status: "entregue",
            sent_at: botNowIso,
            delivered_at: botNowIso,
          })
          .select("*")
          .maybeSingle();

        if (outboundError) {
          const code = String((outboundError as any)?.code ?? "").trim();
          if (code !== "23505") {
            return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
          }
        }

        await syncConversationPreview({
          conversationId: String(conversation.id),
          contentText: positiveFollowUpMessage,
          createdAt: botNowIso,
        });
        outbound = outboundError ? null : ((outboundMessage as Record<string, unknown> | null) ?? null);
      }

      return Response.json({
        ok: true,
        inbound,
        outbound,
        blocked: false,
        conversation: {
          id: String(conversation.id),
          bot_enabled: true,
        },
      });
    }

    await sleep(POST_LEAD_REPLY_DELAY_MS);
    const botNowIso = new Date().toISOString();
    const { data: outbound, error: outboundError } = await admin
      .from("atendimento_messages")
      .insert({
        conversation_id: String(conversation.id),
        sender_role: "bot",
        content_text: PHONE_CONFIRMATION_PROMPT_MESSAGE,
        media_type: "text",
        status: "entregue",
        sent_at: botNowIso,
        delivered_at: botNowIso,
      })
      .select("*")
      .maybeSingle();

    if (outboundError) {
      const code = String((outboundError as any)?.code ?? "").trim();
      if (code !== "23505") {
        return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
      }
    }

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: PHONE_CONFIRMATION_PROMPT_MESSAGE,
      createdAt: botNowIso,
    });

    return Response.json({
      ok: true,
      inbound,
      outbound: outboundError ? null : outbound,
      blocked: false,
      conversation: {
        id: String(conversation.id),
        bot_enabled: true,
      },
    });
  }

  if (expectedField === "phone") {
    await admin
      .from("atendimento_leads")
      .update({
        unread_count: Number(lead.unread_count ?? 0) + 1,
        is_new_for_attendant: true,
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", String(lead.id));

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: getAtendimentoConversationPreviewText({ contentText, mediaType, fileName }),
      createdAt: nowIso,
    });

    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "message_received",
      title: "Mensagem recebida do lead",
      details: {
        content_text: contentText || null,
        media_type: mediaType,
        media_url: mediaUrl,
        mime_type: mimeType,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
      },
      actorType: "lead",
    });

    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "phone_confirmation_pending",
      title: "Aguardando confirmação do número de WhatsApp",
      details: {
        phone: String(captured.phone ?? contentText ?? "").trim(),
      },
      actorType: "system",
    });

    await sleep(POST_LEAD_REPLY_DELAY_MS);
    const botNowIso = new Date().toISOString();
    const { data: outbound, error: outboundError } = await admin
      .from("atendimento_messages")
      .insert({
        conversation_id: String(conversation.id),
        sender_role: "bot",
        content_text: PHONE_CONFIRMATION_PROMPT_MESSAGE,
        media_type: "text",
        status: "entregue",
        sent_at: botNowIso,
        delivered_at: botNowIso,
      })
      .select("*")
      .maybeSingle();

    if (outboundError) {
      const code = String((outboundError as any)?.code ?? "").trim();
      if (code !== "23505") {
        return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
      }
    }

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: PHONE_CONFIRMATION_PROMPT_MESSAGE,
      createdAt: botNowIso,
    });

    return Response.json({
      ok: true,
      inbound,
      outbound: outboundError ? null : outbound,
      blocked: false,
      conversation: {
        id: String(conversation.id),
        bot_enabled: true,
      },
    });
  }

  const locationValidationField = expectedField === "state" || expectedField === "city" ? expectedField : null;
  if (locationValidationField) {
    const phoneForLocationValidation = String(captured.phone ?? (lead as any)?.phone ?? "").trim() || null;
    const currentState = String(captured.state ?? (lead as any)?.state ?? "").trim();
    const currentCity = String(captured.city ?? "").trim();

    const stateResolution = currentState
      ? resolveTimeZoneFromStateInput({
          state: currentState,
          phone: phoneForLocationValidation,
        })
      : null;
    const cityResolution =
      locationValidationField === "city" && currentCity
        ? resolveTimeZoneFromCityInput({
            city: currentCity,
            state: currentState,
            phone: phoneForLocationValidation,
            allowPhoneCountryFallback: false,
          })
        : null;

    const locationValidationPassed =
      locationValidationField === "state" ? Boolean(stateResolution) : Boolean(cityResolution);

    if (!locationValidationPassed) {
      const nextFailureAttempt =
        (await getLocationValidationFailureCount({
          admin,
          leadId: String(lead.id),
          conversationId: String(conversation.id),
          field: locationValidationField,
        })) + 1;
      const shouldBlockConversation = nextFailureAttempt >= MAX_LOCATION_VALIDATION_ATTEMPTS;
      const replyMessage = shouldBlockConversation
        ? getLocationBlockedFinalMessage(locationValidationField)
        : buildLocationRetryMessage(locationValidationField, nextFailureAttempt);

      await admin
        .from("atendimento_leads")
        .update({
          unread_count: Number(lead.unread_count ?? 0) + 1,
          is_new_for_attendant: true,
          last_interaction_at: nowIso,
          updated_at: nowIso,
          ...(shouldBlockConversation
            ? {
                status: "encerrado",
                funnel_stage: "encerrado",
              }
            : {}),
        })
        .eq("id", String(lead.id));

      await syncConversationPreview({
        conversationId: String(conversation.id),
        contentText: getAtendimentoConversationPreviewText({ contentText, mediaType, fileName }),
        createdAt: nowIso,
      });

      await appendHistoryEvent({
        leadId: String(lead.id),
        conversationId: String(conversation.id),
        eventType: "message_received",
        title: "Mensagem recebida do lead",
        details: {
          content_text: contentText || null,
          media_type: mediaType,
          media_url: mediaUrl,
          mime_type: mimeType,
          file_name: fileName,
          file_size_bytes: fileSizeBytes,
        },
        actorType: "lead",
      });

      await appendHistoryEvent({
        leadId: String(lead.id),
        conversationId: String(conversation.id),
        eventType: getLocationFailureEventType(locationValidationField),
        title:
          locationValidationField === "state"
            ? "Falha ao identificar o estado informado"
            : "Falha ao identificar a cidade informada",
        details: {
          field: locationValidationField,
          attempt: nextFailureAttempt,
          content_text: contentText || null,
          state: currentState || null,
          city: currentCity || null,
        },
        actorType: "system",
      });

      if (shouldBlockConversation) {
        await admin
          .from("atendimento_conversations")
          .update({
            bot_enabled: false,
            updated_at: nowIso,
          })
          .eq("id", String(conversation.id));

        await appendHistoryEvent({
          leadId: String(lead.id),
          conversationId: String(conversation.id),
          eventType: "conversation_closed",
          title: "Atendimento encerrado após 3 falhas de identificação de localização",
          details: {
            field: locationValidationField,
            invalid_attempts: nextFailureAttempt,
            source: "location_validation",
          },
          actorType: "system",
        });
      }

      await sleep(POST_LEAD_REPLY_DELAY_MS);
      const botNowIso = new Date().toISOString();
      const { data: outbound, error: outboundError } = await admin
        .from("atendimento_messages")
        .insert({
          conversation_id: String(conversation.id),
          sender_role: "bot",
          content_text: replyMessage,
          media_type: "text",
          status: "entregue",
          sent_at: botNowIso,
          delivered_at: botNowIso,
        })
        .select("*")
        .maybeSingle();

      if (outboundError) {
        const code = String((outboundError as any)?.code ?? "").trim();
        if (code !== "23505") {
          return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
        }
      }

      await syncConversationPreview({
        conversationId: String(conversation.id),
        contentText: replyMessage,
        createdAt: botNowIso,
      });

      return Response.json({
        ok: true,
        inbound,
        outbound: outboundError ? null : outbound,
        blocked: shouldBlockConversation,
        conversation: {
          id: String(conversation.id),
          bot_enabled: !shouldBlockConversation,
        },
      });
    }

    if (stateResolution) {
      captured.state = stateResolution.state;
    }

    if (cityResolution) {
      captured.state = cityResolution.state ?? currentState;
      captured.city = cityResolution.city;
    }
  }

  if (!expectedField && String((lead as any)?.phone ?? "").trim()) {
    const leadId = String(lead.id);
    const conversationId = String(conversation.id);
    const leadTimeZone = String((lead as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
    const lastBotText = String(lastBotMessage?.content_text ?? "").trim();

    await admin
      .from("atendimento_leads")
      .update({
        unread_count: Number(lead.unread_count ?? 0) + 1,
        is_new_for_attendant: true,
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", String(lead.id));

    await syncConversationPreview({
      conversationId: String(conversation.id),
      contentText: getAtendimentoConversationPreviewText({ contentText, mediaType, fileName }),
      createdAt: nowIso,
    });

    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "message_received",
      title: "Mensagem recebida do lead",
      details: {
        content_text: contentText || null,
        media_type: mediaType,
        media_url: mediaUrl,
        mime_type: mimeType,
        file_name: fileName,
        file_size_bytes: fileSizeBytes,
      },
      actorType: "lead",
    });

    const scheduledBooking = await getScheduledExperimentalClassBooking({
      admin,
      leadId,
    });

    if (scheduledBooking?.id) {
      return Response.json({
        ok: true,
        inbound,
        outbound: null,
        blocked: false,
        conversation: {
          id: conversationId,
          bot_enabled: true,
        },
      });
    }

    if (lastBotText.startsWith("Horários disponíveis")) {
      const latestTimeOptionsEvent = await getLatestHistoryEventByType({
        admin,
        leadId,
        conversationId,
        eventType: "experimental_class_time_options_presented",
      });
      const latestTimeDetails = (latestTimeOptionsEvent?.details ?? {}) as Record<string, unknown>;
      const professorDate = String(latestTimeDetails.professor_date ?? "").trim();

      if (!professorDate) {
        const dateOptionsPresentation = await presentExperimentalClassDateOptions({
          admin,
          leadId,
          conversationId,
          leadTimeZone,
        });

        return Response.json({
          ok: true,
          inbound,
          outbound: dateOptionsPresentation.outbound,
          blocked: false,
          conversation: {
            id: conversationId,
            bot_enabled: true,
          },
        });
      }

      const bookedProfessorStarts = await listScheduledExperimentalClassProfessorStarts({
        admin,
        nowIso: nowIso,
      });
      const currentAvailability = listExperimentalClassAvailability({
        leadTimeZone,
        bookedProfessorStartAts: bookedProfessorStarts,
      });
      const timeOptions = currentAvailability.slotsByProfessorDate.get(professorDate) ?? [];
      const selectedTimeOption = findExperimentalClassTimeOption(contentText, timeOptions);

      if (!selectedTimeOption) {
        const timeOptionsPresentation = await presentExperimentalClassTimeOptions({
          admin,
          leadId,
          conversationId,
          leadTimeZone,
          professorDate,
        });

        return Response.json({
          ok: true,
          inbound,
          outbound: timeOptionsPresentation.outbound,
          blocked: false,
          conversation: {
            id: conversationId,
            bot_enabled: true,
          },
        });
      }

      const bookingReservation = await reserveExperimentalClassSlot({
        admin,
        leadId,
        conversationId,
        leadTimeZone,
        selectedTimeOption,
      });

      if (bookingReservation.conflict) {
        const refreshedTimeOptionsPresentation = await presentExperimentalClassTimeOptions({
          admin,
          leadId,
          conversationId,
          leadTimeZone,
          professorDate,
        });

        return Response.json({
          ok: true,
          inbound,
          outbound: refreshedTimeOptionsPresentation.outbound,
          blocked: false,
          conversation: {
            id: conversationId,
            bot_enabled: true,
          },
        });
      }

      await admin
        .from("atendimento_leads")
        .update({
          funnel_stage: "aula_experimental_agendada",
          status: "em_atendimento",
          best_contact_time: selectedTimeOption.leadTime,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId);

      await appendHistoryEvent({
        leadId,
        conversationId,
        eventType: "experimental_class_scheduled",
        title: "Aula experimental agendada automaticamente",
        details: {
          booking_id: String((bookingReservation.booking as any)?.id ?? ""),
          teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
          lead_timezone: leadTimeZone,
          professor_date: selectedTimeOption.professorDate,
          professor_time: selectedTimeOption.professorTime,
          professor_start_at: selectedTimeOption.professorStartAt,
          lead_date: selectedTimeOption.leadDate,
          lead_time: selectedTimeOption.leadTime,
        },
        actorType: "system",
      });

      const firstName = firstNameFromLead(lead as { full_name?: string | null }) || "Aluno";
      const botMessages = [
        EXPERIMENTAL_CLASS_BOOKING_SUCCESS_MESSAGE,
        EXPERIMENTAL_CLASS_WHATSAPP_NOTICE_MESSAGE,
        buildExperimentalClassFinalChatMessage(firstName),
      ];
      let lastOutbound: Record<string, unknown> | null = null;
      for (let index = 0; index < botMessages.length; index += 1) {
        lastOutbound = await insertBotTextMessage({
          admin,
          conversationId,
          contentText: botMessages[index],
          sentAt: new Date(Date.now() + index).toISOString(),
        });
      }

      try {
        const phone = String((lead as any)?.phone ?? "").trim();
        if (phone) {
          await sendAtendimentoWhatsAppText({
            phone,
            message: buildExperimentalClassStudentWhatsAppMessage(firstName),
          });
        }
      } catch (error) {
        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_class_whatsapp_confirmation_failed",
          title: "Falha ao enviar a confirmação da aula experimental no WhatsApp",
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
          actorType: "system",
        });
      }

      await syncConversationPreview({
        conversationId,
        contentText: botMessages[botMessages.length - 1],
        createdAt: String(lastOutbound?.created_at ?? new Date().toISOString()),
      });

      return Response.json({
        ok: true,
        inbound,
        outbound: lastOutbound,
        blocked: false,
        conversation: {
          id: conversationId,
          bot_enabled: true,
        },
      });
    }

    const bookedProfessorStarts = await listScheduledExperimentalClassProfessorStarts({
      admin,
      nowIso,
    });
    const availability = listExperimentalClassAvailability({
      leadTimeZone,
      bookedProfessorStartAts: bookedProfessorStarts,
    });
    const selectedDateOption = findExperimentalClassDateOption(contentText, availability.dates);

    if (!selectedDateOption) {
      const dateOptionsPresentation = await presentExperimentalClassDateOptions({
        admin,
        leadId,
        conversationId,
        leadTimeZone,
      });

      return Response.json({
        ok: true,
        inbound,
        outbound: dateOptionsPresentation.outbound,
        blocked: false,
        conversation: {
          id: conversationId,
          bot_enabled: true,
        },
      });
    }

    await appendHistoryEvent({
      leadId,
      conversationId,
      eventType: "experimental_class_date_selected",
      title: "Data da aula experimental selecionada",
      details: {
        teacher_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
        lead_timezone: leadTimeZone,
        professor_date: selectedDateOption.professorDate,
        lead_date: selectedDateOption.leadDate,
        date_label: selectedDateOption.displayLabel,
      },
      actorType: "system",
    });

    const timeOptionsPresentation = await presentExperimentalClassTimeOptions({
      admin,
      leadId,
      conversationId,
      leadTimeZone,
      professorDate: selectedDateOption.professorDate,
    });

    return Response.json({
      ok: true,
      inbound,
      outbound: timeOptionsPresentation.outbound,
      blocked: false,
      conversation: {
        id: conversationId,
        bot_enabled: true,
      },
    });
  }

  const locationContext = buildLeadLocationContext({
    captured,
    leadState: String((lead as any)?.state ?? "").trim() || null,
    phone: String(captured.phone ?? (lead as any)?.phone ?? "").trim() || null,
  });
  const persistedLeadValues = locationContext.leadPatch;
  const persistedCapturedValues = locationContext.capturedFieldValues;
  const nextLead = {
    ...lead,
    ...persistedLeadValues,
  };
  const nextMissingField = getNextMissingField(nextLead as any);
  const botResponse = botReplyForLead({ lead: nextLead as any, messageText: contentText });
  const nextStage = nextMissingField ? botResponse.stage : "pre_cadastro_concluido";
  const nextStatus = nextMissingField ? botResponse.status : "matricula_pendente";

  await admin
    .from("atendimento_leads")
    .update({
      ...persistedLeadValues,
      status: nextStatus,
      funnel_stage: nextStage,
      unread_count: Number(lead.unread_count ?? 0) + 1,
      is_new_for_attendant: true,
      last_interaction_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", String(lead.id));

  await upsertCapturedFields({
    leadId: String(lead.id),
    sourceMessageId: String(inbound.id),
    values: persistedCapturedValues,
  });

  await syncConversationPreview({
    conversationId: String(conversation.id),
    contentText: getAtendimentoConversationPreviewText({ contentText, mediaType, fileName }),
    createdAt: nowIso,
  });

  await appendHistoryEvent({
    leadId: String(lead.id),
    conversationId: String(conversation.id),
    eventType: "message_received",
    title: "Mensagem recebida do lead",
    details: {
      content_text: contentText || null,
      media_type: mediaType,
      media_url: mediaUrl,
      mime_type: mimeType,
      file_name: fileName,
      file_size_bytes: fileSizeBytes,
    },
    actorType: "lead",
  });

  if (Object.keys(persistedCapturedValues).length > 0) {
    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "data_captured",
      title: "Dados capturados automaticamente",
      details: persistedCapturedValues,
      actorType: "system",
    });
  }

  if (locationContext.historyDetails) {
    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "lead_timezone_identified",
      title: "Cidade e fuso do lead identificados automaticamente",
      details: locationContext.historyDetails,
      actorType: "system",
    });
  }

  await sleep(POST_LEAD_REPLY_DELAY_MS);
  const botNowIso = new Date().toISOString();

  const { data: lastBotBeforeInsert } = await admin
    .from("atendimento_messages")
    .select("*")
    .eq("conversation_id", String(conversation.id))
    .eq("sender_role", "bot")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastBotBeforeInsertCreatedAtMs = new Date(String((lastBotBeforeInsert as any)?.created_at ?? "")).getTime();
  const botResponseText = String(botResponse.message ?? "").trim();
  const botResponseMessages =
    botResponseText === EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE
      ? buildExperimentalClassDatePromptMessages(
          String((persistedLeadValues as Record<string, unknown>)?.full_name ?? (lead as any)?.full_name ?? "").trim(),
        )
      : [botResponseText];
  const shouldReuseLastBotMessage = Boolean(
    lastBotBeforeInsert?.id &&
      botResponseText &&
      String((lastBotBeforeInsert as any)?.content_text ?? "").trim() === botResponseText &&
      !Number.isNaN(lastBotBeforeInsertCreatedAtMs) &&
      Date.now() - lastBotBeforeInsertCreatedAtMs < POST_LEAD_REPLY_DELAY_MS + 4000,
  );

  if (shouldReuseLastBotMessage) {
    if (botResponseText === EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE) {
      const dateOptionsPresentation = await presentExperimentalClassDateOptions({
        admin,
        leadId: String(lead.id),
        conversationId: String(conversation.id),
        leadTimeZone: String((persistedLeadValues.timezone as string | undefined) ?? (lead as any)?.timezone ?? "").trim(),
      });

      return Response.json({
        ok: true,
        inbound,
        outbound: dateOptionsPresentation.outbound,
        blocked: false,
        conversation: {
          id: String(conversation.id),
          bot_enabled: true,
        },
      });
    }

    return Response.json({
      ok: true,
      inbound,
      outbound: lastBotBeforeInsert,
      blocked: false,
      conversation: {
        id: String(conversation.id),
        bot_enabled: true,
      },
    });
  }

  let outbound: Record<string, unknown> | null = null;
  let outboundError: { message?: string; code?: string } | null = null;
  for (const message of botResponseMessages) {
    try {
      outbound = await insertBotTextMessage({
        admin,
        conversationId: String(conversation.id),
        contentText: message,
        sentAt: botNowIso,
      });
    } catch (error) {
      outboundError = error instanceof Error ? { message: error.message } : { message: String(error) };
      break;
    }
  }

  if (outboundError) {
    return Response.json({ ok: false, error: outboundError.message }, { status: 500 });
  }

  await syncConversationPreview({
    conversationId: String(conversation.id),
    contentText: botResponseMessages[botResponseMessages.length - 1] ?? botResponse.message,
    createdAt: botNowIso,
  });

  let finalOutbound = outbound;
  if (botResponseText === EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE) {
    const dateOptionsPresentation = await presentExperimentalClassDateOptions({
      admin,
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      leadTimeZone: String((persistedLeadValues.timezone as string | undefined) ?? (lead as any)?.timezone ?? "").trim(),
    });
    finalOutbound = dateOptionsPresentation.outbound;
  }

  await appendHistoryEvent({
    leadId: String(lead.id),
    conversationId: String(conversation.id),
    eventType: "stage_changed",
    title: "Etapa do funil atualizada automaticamente",
    details: { status: nextStatus, funnel_stage: nextStage },
    actorType: "bot",
  });

  return Response.json({
    ok: true,
    inbound,
    outbound: finalOutbound,
    blocked: false,
    conversation: {
      id: String(conversation.id),
      bot_enabled: true,
    },
  });
}
