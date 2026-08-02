import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ATENDIMENTO_EMAIL, ATENDIMENTO_PUBLIC_LINK_SLUG } from "@/lib/atendimento/constants";
import {
  ATENDIMENTO_FILES_BUCKET,
  ATENDIMENTO_ALLOWED_UPLOAD_MIME_TYPES,
  buildAtendimentoStoragePath,
  getAtendimentoMediaTypeFromMimeType,
} from "@/lib/atendimento/files";
import { initialBotMessages } from "@/lib/atendimento/bot";
import {
  buildExperimentalClassAttendantStartReminderWhatsAppMessage,
  buildExperimentalClassStudentLessonReadyWhatsAppMessage,
  EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
  EXPERIMENTAL_CLASS_ATTENDANT_START_REMINDER_MINUTES,
} from "@/lib/atendimento/experimentalClass";
import { buildAtendimentoPublicUrl, isAtendimentoEmail, makeConversationSessionSlug, summarizePreview } from "@/lib/atendimento/utils";
import { isAtendimentoOnlyAccessScope, normalizeAccessScope } from "@/lib/auth/access";
import { zonedDateTimeToUtcIso } from "@/lib/timezone";

const ATENDIMENTO_DAILY_SUMMARY_PHONE = "+55 65 9985-1142";
const ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE = "America/Cuiaba";
const ATENDIMENTO_DAILY_SUMMARY_LINK = "https://www.autobot.business/app/atendimento";
const ATENDIMENTO_DAILY_SUMMARY_TRIGGER_HOUR = 20;
export const ATENDIMENTO_PRESENCE_SESSION_TTL_MS = 45_000;

function buildDeterministicInitialBotMessageId(conversationId: string, contentText: string) {
  const hash = crypto
    .createHash("sha256")
    .update(`initial-bot:${String(conversationId).trim()}:${String(contentText).trim()}`)
    .digest("hex")
    .slice(0, 32)
    .split("");

  hash[12] = "5";
  hash[16] = ["8", "9", "a", "b"][parseInt(hash[16] ?? "0", 16) % 4] ?? "8";
  return `${hash.slice(0, 8).join("")}-${hash.slice(8, 12).join("")}-${hash.slice(12, 16).join("")}-${hash.slice(16, 20).join("")}-${hash.slice(20, 32).join("")}`;
}

function normalizePhone(phone: string) {
  const raw = String(phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return digits;
  if (digits.startsWith("55")) return digits;
  if (digits.startsWith("1") && digits.length === 11) return digits;
  if (digits.length === 11) return `55${digits}`;
  return digits;
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

function normalizePhoneDigitsOnly(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

function phoneMatches(stored: string | null | undefined, search: string): boolean {
  const s = normalizePhoneDigitsOnly(stored);
  if (!s) return false;
  return s === search;
}

function getLeadFirstName(name: string | null | undefined) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[0] ?? "Aluno";
}

function getLeadFullName(name: string | null | undefined) {
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  return clean || getLeadFirstName(name);
}

function localDateInTimeZone(value: Date | string | number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDaysToLocalDate(localDate: string, days: number) {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + days);
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function localTimePartsInTimeZone(value: Date | string | number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    hour: Number(map.hour ?? 0),
    minute: Number(map.minute ?? 0),
  };
}

function buildAtendimentoDailySummaryMessage(leadsCount: number) {
  return `📊 Resumo diário de interessados – AutoBot

Hoje entraram ${leadsCount} novos interessados na fila de atendimento.

Acesse o painel para visualizar todos os leads e iniciar os atendimentos:

${ATENDIMENTO_DAILY_SUMMARY_LINK}`;
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

function isExperimentalClassBookingsLessonLinkColumnUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /column .*lesson_link.* does not exist/i.test(message) ||
    /could not find the 'lesson_link' column of 'atendimento_experimental_class_bookings' in the schema cache/i.test(
      message,
    )
  );
}

function isExperimentalClassBookingsNotificationSentColumnsUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "42P01" ||
    /column .*(student_start_notification_sent_at|attendant_start_notification_sent_at|attendance_status|attendance_checked_at).* does not exist/i.test(
      message,
    ) ||
    /could not find the '(student_start_notification_sent_at|attendant_start_notification_sent_at|attendance_status|attendance_checked_at)' column of 'atendimento_experimental_class_bookings' in the schema cache/i.test(
      message,
    )
  );
}

async function countAtendimentoDailyInterestedLeads(params: {
  rangeStartIso: string;
  rangeEndIso: string;
}) {
  const admin = createSupabaseAdminClient();
  const [
    { data: createdLeads, error: leadsError },
    { data: leadMessages, error: leadMessagesError },
  ] =
    await Promise.all([
      admin
        .from("atendimento_leads")
        .select("id")
        .gte("created_at", params.rangeStartIso)
        .lt("created_at", params.rangeEndIso),
      admin
        .from("atendimento_messages")
        .select("conversation_id")
        .eq("sender_role", "lead")
        .gte("created_at", params.rangeStartIso)
        .lt("created_at", params.rangeEndIso),
    ]);

  if (leadsError) {
    throw new Error(leadsError.message || "Falha ao listar leads do resumo diario do atendimento.");
  }

  if (leadMessagesError) {
    throw new Error(leadMessagesError.message || "Falha ao listar mensagens do lead no resumo diario do atendimento.");
  }

  const leadConversationIds = Array.from(
    new Set(
      (leadMessages ?? [])
        .map((row: any) => String(row?.conversation_id ?? "").trim())
        .filter(Boolean),
    ),
  );

  let conversationLeadIds = new Set<string>();
  if (leadConversationIds.length > 0) {
    const { data: conversations, error: conversationsError } = await admin
      .from("atendimento_conversations")
      .select("id, lead_id")
      .in("id", leadConversationIds);

    if (conversationsError) {
      throw new Error(conversationsError.message || "Falha ao listar conversas do resumo diario do atendimento.");
    }

    conversationLeadIds = new Set(
      (conversations ?? [])
        .map((row: any) => String(row?.lead_id ?? "").trim())
        .filter(Boolean),
    );
  }

  let leadsWithoutConversationCount = 0;
  for (const row of createdLeads ?? []) {
    const leadId = String((row as any)?.id ?? "").trim();
    if (!leadId) continue;
    if (!conversationLeadIds.has(leadId)) leadsWithoutConversationCount += 1;
  }

  return leadConversationIds.length + leadsWithoutConversationCount;
}

/** @deprecated Notificacao offline de nova mensagem DESATIVADA por pedido do usuario (nao enviar mais). Funcao mantida apenas para compilacao, retorna string vazia. */
export function buildAtendimentoConversationPublicUrl(_publicSlug: string) {
  return ``;
}

/** @deprecated Notificacao offline de nova mensagem DESATIVADA por pedido do usuario (nao enviar mais). Funcao mantida apenas para compilacao, retorna string vazia. */
export function buildOfflineAttendantNotificationMessage(_params: {
  leadName?: string | null;
  publicSlug: string;
}) {
  return ``;
}

function buildAuthorizedZapiWebhookUrl(baseUrl: string) {
  const webhookUrl = new URL(`${baseUrl}/api/webhooks/zapi`);
  const secret = String(process.env.ZAPI_WEBHOOK_SECRET ?? "").trim();
  if (secret) {
    webhookUrl.searchParams.set("secret", secret);
  }
  return webhookUrl.toString();
}

async function sendZapiText(params: {
  instance_id: string;
  token: string;
  client_token?: string | null;
  phone: string;
  message: string;
}) {
  const normalizedPhone = normalizePhone(params.phone);
  const body = JSON.stringify({ phone: normalizedPhone, message: params.message });
  const baseUrl = `https://api.z-api.io/instances/${encodeURIComponent(params.instance_id)}`;
  const urlWithTokenInPath = `${baseUrl}/token/${encodeURIComponent(params.token)}/send-text`;
  const urlWithHeader = `${baseUrl}/send-text`;

  const trySend = async (url: string, includeHeaderToken: boolean) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(includeHeaderToken && params.client_token ? { "Client-Token": params.client_token } : {}),
      },
      body,
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  };

  const first = await trySend(urlWithTokenInPath, Boolean(params.client_token));
  if (first.response.ok) return first.data;

  const errText = JSON.stringify(first.data ?? "");
  const mentionsClientToken = /client-token/i.test(errText);
  const isForbidden = first.response.status === 403;
  const isBadRequest = first.response.status === 400;

  if (mentionsClientToken && !params.client_token) {
    throw new Error("Client-Token não configurado no WhatsApp.");
  }

  if ((isBadRequest || isForbidden) && mentionsClientToken) {
    const second = await trySend(urlWithHeader, Boolean(params.client_token));
    if (second.response.ok) return second.data;
    throw new Error(
      `Falha ao enviar: ${second.response.status} ${JSON.stringify(second.data) ?? ""}`.trim(),
    );
  }

  throw new Error(
    `Falha ao enviar: ${first.response.status} ${JSON.stringify(first.data) ?? ""}`.trim(),
  );
}

export async function getZapiInstanceMeta(params: {
  instance_id: string;
  token: string;
  client_token?: string | null;
}) {
  const response = await fetch(
    `https://api.z-api.io/instances/${encodeURIComponent(params.instance_id)}/token/${encodeURIComponent(params.token)}/me`,
    {
      method: "GET",
      headers: {
        ...(params.client_token ? { "Client-Token": params.client_token } : {}),
      },
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Falha ao consultar instância Z-API: ${response.status} ${JSON.stringify(data) ?? ""}`.trim(),
    );
  }
  return data;
}

async function updateZapiWebhook(params: {
  instance_id: string;
  token: string;
  client_token?: string | null;
  endpoint: string;
  value: string;
  extraBody?: Record<string, unknown>;
}) {
  const response = await fetch(
    `https://api.z-api.io/instances/${encodeURIComponent(params.instance_id)}/token/${encodeURIComponent(params.token)}/${params.endpoint}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(params.client_token ? { "Client-Token": params.client_token } : {}),
      },
      body: JSON.stringify({
        value: params.value,
        ...(params.extraBody ?? {}),
      }),
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Falha ao configurar webhook ${params.endpoint}: ${response.status} ${JSON.stringify(data) ?? ""}`.trim(),
    );
  }
  return data;
}

async function getAtendimentoWhatsAppConfig() {
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, email")
    .ilike("email", ATENDIMENTO_EMAIL)
    .maybeSingle();

  const userId = String((profile as any)?.user_id ?? "").trim();
  if (!userId) return null;

  const { data: wa } = await admin
    .from("whatsapp_instances")
    .select("instance_id, token, client_token, status")
    .eq("user_id", userId)
    .maybeSingle();
  const canSend =
    Boolean((wa as any)?.instance_id) &&
    Boolean((wa as any)?.token);

  if (!canSend) {
    return null;
  }

  return {
    instance_id: String((wa as any).instance_id),
    token: String((wa as any).token),
    client_token: String((wa as any)?.client_token ?? "").trim() || null,
  };
}

export async function sendAtendimentoWhatsAppText(params: {
  phone: string;
  message: string;
  baseUrl?: string | null;
}) {
  const config = await getAtendimentoWhatsAppConfig();
  if (!config) {
    throw new Error("WhatsApp do atendimento não configurado.");
  }

  const normalizedDest = normalizePhoneDigitsOnly(params.phone);
  const internalNotificationPhones = new Set(
    [ATENDIMENTO_DAILY_SUMMARY_PHONE, EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE].map((value) =>
      normalizePhoneDigitsOnly(value),
    ),
  );

  if (normalizedDest && !internalNotificationPhones.has(normalizedDest)) {
    const admin = createSupabaseAdminClient();
    const { data: leadRow } = await admin
      .from("atendimento_leads")
      .select("id")
      .ilike("phone", `%${normalizedDest}%`)
      .limit(1)
      .maybeSingle();

    if (leadRow?.id) {
      const { data: conversationRow } = await admin
        .from("atendimento_conversations")
        .select("id")
        .eq("lead_id", String((leadRow as any).id))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const conversationId = String((conversationRow as any)?.id ?? "").trim();

      if (!conversationId) {
        return {
          ok: false,
          skipped: true,
          reason: "no_conversation_found_for_lead",
          phone: normalizedDest,
        };
      }

      const { count: inboundCount } = await admin
        .from("atendimento_messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversationId)
        .eq("sender_role", "lead");

      if (Number(inboundCount ?? 0) <= 0) {
        return {
          ok: false,
          skipped: true,
          reason: "no_prior_inbound_message_from_lead",
          phone: normalizedDest,
        };
      }
    } else {
      return {
        ok: false,
        skipped: true,
        reason: "unknown_lead_no_prior_inbound",
        phone: normalizedDest,
      };
    }
  }

  const baseUrl = String(params.baseUrl ?? "").trim().replace(/\/$/, "");
  if (baseUrl) {
    const webhookUrl = buildAuthorizedZapiWebhookUrl(baseUrl);
    await updateZapiWebhook({
      instance_id: config.instance_id,
      token: config.token,
      client_token: config.client_token,
      endpoint: "update-every-webhooks",
      value: webhookUrl,
      extraBody: { notifySentByMe: true },
    });
  }

  const result = await sendZapiText({
    instance_id: config.instance_id,
    token: config.token,
    client_token: config.client_token,
    phone: params.phone,
    message: params.message,
  });

  return result;
}

export async function sendAtendimentoDailyLeadSummary(now = new Date()) {
  const admin = createSupabaseAdminClient();
  const nowIso = now.toISOString();
  const summaryDate = localDateInTimeZone(now, ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE);
  const localTime = localTimePartsInTimeZone(now, ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE);
  if (localTime.hour < ATENDIMENTO_DAILY_SUMMARY_TRIGGER_HOUR) {
    return {
      ok: true as const,
      skipped: true as const,
      reason: "before_trigger_time",
      summaryDate,
      leadsCount: null,
    };
  }

  const nextSummaryDate = addDaysToLocalDate(summaryDate, 1);
  const rangeStartIso = zonedDateTimeToUtcIso({
    date: summaryDate,
    time: "00:00",
    timeZone: ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE,
  });
  const rangeEndIso = zonedDateTimeToUtcIso({
    date: nextSummaryDate,
    time: "00:00",
    timeZone: ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE,
  });

  const { data: existingRun, error: existingRunError } = await admin
    .from("atendimento_daily_summary_runs")
    .select("summary_date, sent_at, attempt_count")
    .eq("summary_date", summaryDate)
    .maybeSingle();

  if (existingRunError) {
    throw new Error(existingRunError.message || "Falha ao consultar o resumo diario do atendimento.");
  }

  if (existingRun?.sent_at) {
    return {
      ok: true as const,
      skipped: true as const,
      reason: "already_sent",
      summaryDate,
      leadsCount: Number((existingRun as any)?.leads_count ?? 0) || null,
    };
  }

  const nextAttemptCount = Number((existingRun as any)?.attempt_count ?? 0) + 1;
  const leasePayload = {
    summary_date: summaryDate,
    timezone: ATENDIMENTO_DAILY_SUMMARY_TIME_ZONE,
    sent_at: null,
    last_attempt_at: nowIso,
    attempt_count: nextAttemptCount,
    last_error: null,
  };

  if (existingRun?.summary_date) {
    const { error: updateLeaseError } = await admin
      .from("atendimento_daily_summary_runs")
      .update(leasePayload)
      .eq("summary_date", summaryDate)
      .is("sent_at", null);

    if (updateLeaseError) {
      throw new Error(updateLeaseError.message || "Falha ao atualizar a tentativa do resumo diario do atendimento.");
    }
  } else {
    const { error: insertLeaseError } = await admin.from("atendimento_daily_summary_runs").insert(leasePayload);
    if (insertLeaseError) {
      const code = String((insertLeaseError as any)?.code ?? "").trim();
      if (code === "23505") {
        return {
          ok: true as const,
          skipped: true as const,
          reason: "already_reserved",
          summaryDate,
          leadsCount: null,
        };
      }
      throw new Error(insertLeaseError.message || "Falha ao reservar o resumo diario do atendimento.");
    }
  }

  let leadsCount = 0;
  try {
    leadsCount = await countAtendimentoDailyInterestedLeads({
      rangeStartIso,
      rangeEndIso,
    });
  } catch (error) {
    await admin
      .from("atendimento_daily_summary_runs")
      .update({
        last_attempt_at: nowIso,
        last_error: error instanceof Error ? error.message : String(error),
      })
      .eq("summary_date", summaryDate);
    throw error;
  }

  try {
    await sendAtendimentoWhatsAppText({
      phone: ATENDIMENTO_DAILY_SUMMARY_PHONE,
      message: buildAtendimentoDailySummaryMessage(leadsCount),
    });

    await admin
      .from("atendimento_daily_summary_runs")
      .update({
        leads_count: leadsCount,
        sent_at: new Date().toISOString(),
        last_attempt_at: nowIso,
        last_error: null,
      })
      .eq("summary_date", summaryDate);

    return { ok: true as const, skipped: false as const, summaryDate, leadsCount };
  } catch (error) {
    await admin
      .from("atendimento_daily_summary_runs")
      .update({
        last_attempt_at: nowIso,
        last_error: error instanceof Error ? error.message : String(error),
      })
      .eq("summary_date", summaryDate);
    throw error;
  }
}

export async function sendExperimentalClassStartNotifications(now = new Date()) {
  const admin = createSupabaseAdminClient();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const lookbackMinutes = 15;
  const candidateWindowStartIso = new Date(nowMs - lookbackMinutes * 60_000).toISOString();
  const attendantReminderUpperIso = new Date(
    nowMs + EXPERIMENTAL_CLASS_ATTENDANT_START_REMINDER_MINUTES * 60_000,
  ).toISOString();

  let bookings: any[] | null = null;
  let bookingsError: any = null;

  const bookingsSelectWithLessonLink =
    "id, lead_id, conversation_id, status, lesson_link, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, student_start_notification_sent_at, attendant_start_notification_sent_at, attendance_status, attendance_checked_at, created_at, updated_at";
  const bookingsSelectWithoutLessonLink =
    "id, lead_id, conversation_id, status, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, student_start_notification_sent_at, attendant_start_notification_sent_at, attendance_status, attendance_checked_at, created_at, updated_at";

  const bookingsWithLessonLinkResult = await admin
    .from("atendimento_experimental_class_bookings")
    .select(bookingsSelectWithLessonLink)
    .eq("status", "scheduled")
    .gte("professor_start_at", candidateWindowStartIso)
    .lte("professor_start_at", attendantReminderUpperIso)
    .order("professor_start_at", { ascending: true });

  if (
    bookingsWithLessonLinkResult.error &&
    isExperimentalClassBookingsLessonLinkColumnUnavailable(bookingsWithLessonLinkResult.error)
  ) {
    const bookingsWithoutLessonLinkResult = await admin
      .from("atendimento_experimental_class_bookings")
      .select(bookingsSelectWithoutLessonLink)
      .eq("status", "scheduled")
      .gte("professor_start_at", candidateWindowStartIso)
      .lte("professor_start_at", attendantReminderUpperIso)
      .order("professor_start_at", { ascending: true });

    bookings = bookingsWithoutLessonLinkResult.data as any[] | null;
    bookingsError = bookingsWithoutLessonLinkResult.error;
  } else {
    bookings = bookingsWithLessonLinkResult.data as any[] | null;
    bookingsError = bookingsWithLessonLinkResult.error;
  }

  if (bookingsError) {
    if (isExperimentalClassBookingsTableUnavailable(bookingsError)) {
      return {
        ok: true as const,
        skipped: true as const,
        reason: "bookings_table_unavailable",
        checkedBookings: 0,
        studentSent: 0,
        attendantSent: 0,
        missingLessonLink: 0,
        missingStudentPhone: 0,
      };
    }

    throw new Error(bookingsError.message || "Falha ao consultar agendamentos da aula experimental.");
  }

  const bookingRows = (bookings ?? []).filter((booking) => String((booking as any)?.id ?? "").trim());
  if (!bookingRows.length) {
    return {
      ok: true as const,
      skipped: true as const,
      reason: "no_due_bookings",
      checkedBookings: 0,
      studentSent: 0,
      attendantSent: 0,
      missingLessonLink: 0,
      missingStudentPhone: 0,
    };
  }

  const leadIds = Array.from(
    new Set(bookingRows.map((booking) => String((booking as any)?.lead_id ?? "").trim()).filter(Boolean)),
  );

  const { data: leads, error: leadsError } = await admin
    .from("atendimento_leads")
    .select("id, full_name, phone")
    .in("id", leadIds);

  if (leadsError) {
    throw new Error(leadsError.message || "Falha ao consultar os leads da aula experimental.");
  }

  const { data: historyEvents, error: historyError } = await admin
    .from("atendimento_history_events")
    .select("lead_id, conversation_id, event_type, details, created_at")
    .in("lead_id", leadIds)
    .in("event_type", [
      "experimental_class_link_updated",
      "experimental_class_student_start_notification_sent",
      "experimental_class_attendant_start_notification_sent",
    ])
    .order("created_at", { ascending: false });

  if (historyError) {
    throw new Error(historyError.message || "Falha ao consultar o histórico da aula experimental.");
  }

  const leadsById = new Map(
    (leads ?? []).map((lead) => [String((lead as any)?.id ?? "").trim(), lead]),
  );
  const latestLessonLinkByLeadId = new Map<string, string | null>();
  const sentStudentBookingIds = new Set<string>();
  const sentAttendantBookingIds = new Set<string>();

  for (const event of historyEvents ?? []) {
    const leadId = String((event as any)?.lead_id ?? "").trim();
    const eventType = String((event as any)?.event_type ?? "").trim().toLowerCase();
    const details = ((event as any)?.details ?? {}) as Record<string, unknown>;
    const bookingId = String(details.booking_id ?? "").trim();
    const lessonLink = String(details.lesson_link ?? "").trim() || null;

    if (eventType === "experimental_class_link_updated") {
      if (leadId && !latestLessonLinkByLeadId.has(leadId)) {
        latestLessonLinkByLeadId.set(leadId, lessonLink);
      }
      continue;
    }

    if (!bookingId) continue;
    if (eventType === "experimental_class_student_start_notification_sent") {
      sentStudentBookingIds.add(bookingId);
      continue;
    }
    if (eventType === "experimental_class_attendant_start_notification_sent") {
      sentAttendantBookingIds.add(bookingId);
    }
  }

  let studentSent = 0;
  let attendantSent = 0;
  let missingLessonLink = 0;
  let missingStudentPhone = 0;

  async function setBookingNotificationSentAt(params: {
    bookingId: string;
    column:
      | "student_start_notification_sent_at"
      | "attendant_start_notification_sent_at";
    nowIso: string;
  }) {
    try {
      const fullUpdate = await admin
        .from("atendimento_experimental_class_bookings")
        .update({
          [params.column]: params.nowIso,
        } as any)
        .eq("id", params.bookingId);
      if (fullUpdate.error && isExperimentalClassBookingsNotificationSentColumnsUnavailable(fullUpdate.error)) {
        await admin
          .from("atendimento_experimental_class_bookings")
          .update({ updated_at: params.nowIso })
          .eq("id", params.bookingId);
      }
    } catch {
      try {
        await admin
          .from("atendimento_experimental_class_bookings")
          .update({ updated_at: params.nowIso })
          .eq("id", params.bookingId);
      } catch {
        /* noop */
      }
    }
  }

  for (const booking of bookingRows) {
    const bookingId = String((booking as any)?.id ?? "").trim();
    const leadId = String((booking as any)?.lead_id ?? "").trim();
    const conversationId = String((booking as any)?.conversation_id ?? "").trim() || null;
    const lessonLink =
      String((booking as any)?.lesson_link ?? "").trim() ||
      latestLessonLinkByLeadId.get(leadId) ||
      "";
    const professorStartAtRaw = String((booking as any)?.professor_start_at ?? "").trim();
    const leadStartAtRaw = String((booking as any)?.lead_start_at ?? professorStartAtRaw).trim();
    const professorStartAtMs = new Date(professorStartAtRaw).getTime();
    const leadStartAtMs = new Date(leadStartAtRaw).getTime();

    if (
      !bookingId ||
      !leadId ||
      !Number.isFinite(professorStartAtMs) ||
      !Number.isFinite(leadStartAtMs)
    ) continue;

    const lead = leadsById.get(leadId) as any;
    const leadPhone = String(lead?.phone ?? "").trim();
    const leadFirstName = getLeadFirstName(lead?.full_name);
    const leadFullName = getLeadFullName(lead?.full_name);

    if (!lessonLink) {
      missingLessonLink += 1;
      continue;
    }

    const cachedStudentSent =
      sentStudentBookingIds.has(bookingId) ||
      Boolean(String((booking as any)?.student_start_notification_sent_at ?? "").trim());
    const cachedAttendantSent =
      sentAttendantBookingIds.has(bookingId) ||
      Boolean(String((booking as any)?.attendant_start_notification_sent_at ?? "").trim());

    const studentDue = leadStartAtMs <= nowMs;
    const attendantDue =
      professorStartAtMs - EXPERIMENTAL_CLASS_ATTENDANT_START_REMINDER_MINUTES * 60_000 <= nowMs;

    if (attendantDue && !cachedAttendantSent) {
      try {
        await sendAtendimentoWhatsAppText({
          phone: EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
          message: buildExperimentalClassAttendantStartReminderWhatsAppMessage(leadFullName, lessonLink),
        });

        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_class_attendant_start_notification_sent",
          title: "Lembrete de inicio da aula experimental enviado ao atendente",
          details: {
            booking_id: bookingId,
            phone: EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
            lesson_link: lessonLink,
            start_at: professorStartAtRaw,
          },
          actorType: "system",
        });
        await setBookingNotificationSentAt({
          bookingId,
          column: "attendant_start_notification_sent_at",
          nowIso,
        });
        sentAttendantBookingIds.add(bookingId);
        attendantSent += 1;
      } catch (error) {
        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_class_attendant_start_notification_failed",
          title: "Falha ao enviar lembrete de inicio da aula experimental ao atendente",
          details: {
            booking_id: bookingId,
            phone: EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
            lesson_link: lessonLink,
            start_at: professorStartAtRaw,
            error: error instanceof Error ? error.message : String(error),
          },
          actorType: "system",
        });
      }
    }

    if (studentDue && !cachedStudentSent) {
      if (!leadPhone) {
        missingStudentPhone += 1;
        continue;
      }

      try {
        await sendAtendimentoWhatsAppText({
          phone: leadPhone,
          message: buildExperimentalClassStudentLessonReadyWhatsAppMessage(leadFirstName, lessonLink),
        });

        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_class_student_start_notification_sent",
          title: "Link da aula experimental enviado ao aluno no inicio da aula",
          details: {
            booking_id: bookingId,
            phone: leadPhone,
            lesson_link: lessonLink,
            start_at: leadStartAtRaw,
          },
          actorType: "system",
        });
        await setBookingNotificationSentAt({
          bookingId,
          column: "student_start_notification_sent_at",
          nowIso,
        });
        sentStudentBookingIds.add(bookingId);
        studentSent += 1;
      } catch (error) {
        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_class_student_start_notification_failed",
          title: "Falha ao enviar o link da aula experimental ao aluno no inicio da aula",
          details: {
            booking_id: bookingId,
            phone: leadPhone,
            lesson_link: lessonLink,
            start_at: leadStartAtRaw,
            error: error instanceof Error ? error.message : String(error),
          },
          actorType: "system",
        });
      }
    }
  }

  return {
    ok: true as const,
    skipped: false as const,
    checkedBookings: bookingRows.length,
    studentSent,
    attendantSent,
    missingLessonLink,
    missingStudentPhone,
  };
}

export async function requireAtendimentoUser() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id || !isAtendimentoEmail(user.email)) {
    return { ok: false as const, supabase, user: null };
  }
  return { ok: true as const, supabase, user };
}

export async function requireAuthenticatedAtendimentoParticipant() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return { ok: false as const, supabase, user: null, profile: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, email, created_at, access_scope")
    .eq("user_id", user.id)
    .maybeSingle();

  const accessScope = normalizeAccessScope((profile as any)?.access_scope);
  if (!isAtendimentoOnlyAccessScope(accessScope)) {
    return { ok: false as const, supabase, user: null, profile: null };
  }

  return {
    ok: true as const,
    supabase,
    user,
    profile: {
      nome: String((profile as any)?.nome ?? "").trim() || null,
      email: String((profile as any)?.email ?? user.email ?? "").trim().toLowerCase() || null,
      created_at: String((profile as any)?.created_at ?? "").trim() || null,
      access_scope: accessScope,
    },
  };
}

export async function ensureAtendimentoPublicLink(origin?: string) {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("atendimento_public_links")
    .select("id, slug, label, active, assigned_user_email")
    .eq("slug", ATENDIMENTO_PUBLIC_LINK_SLUG)
    .maybeSingle();

  if (existing?.id) {
    return {
      ...(existing as any),
      public_url: origin ? buildAtendimentoPublicUrl(origin) : null,
    };
  }

  const { data } = await admin
    .from("atendimento_public_links")
    .insert({
      slug: ATENDIMENTO_PUBLIC_LINK_SLUG,
      label: "Link principal de atendimento",
      active: true,
      assigned_user_email: ATENDIMENTO_EMAIL,
    })
    .select("id, slug, label, active, assigned_user_email")
    .maybeSingle();

  return {
    ...(data as any),
    public_url: origin ? buildAtendimentoPublicUrl(origin) : null,
  };
}

export async function createPublicLeadSession(params: { origin?: string | null; slug?: string | null }) {
  const admin = createSupabaseAdminClient();
  const publicLink = await ensureAtendimentoPublicLink(params.origin || undefined);
  const publicSlug = String(params.slug ?? "").trim() || String(publicLink.slug ?? "");
  if (!publicSlug || publicSlug !== ATENDIMENTO_PUBLIC_LINK_SLUG) {
    throw new Error("Link de atendimento inválido.");
  }

  const { data: lead } = await admin
    .from("atendimento_leads")
    .insert({
      origin: "link_publico_atendimento",
      status: "novo_lead",
      funnel_stage: "novo_lead",
      assigned_user_email: ATENDIMENTO_EMAIL,
      unread_count: 0,
      is_new_for_attendant: true,
    })
    .select("*")
    .maybeSingle();

  if (!lead?.id) {
    throw new Error("Não foi possível criar o lead.");
  }

  const { data: conversation } = await admin
    .from("atendimento_conversations")
    .insert({
      lead_id: String(lead.id),
      public_link_id: String(publicLink.id ?? ""),
      channel: "web",
      public_slug: makeConversationSessionSlug(),
      bot_enabled: true,
    })
    .select("*")
    .maybeSingle();

  if (!conversation?.id) {
    throw new Error("Não foi possível criar a conversa.");
  }

  return {
    lead,
    conversation,
    publicLink: {
      slug: String(publicLink.slug ?? ATENDIMENTO_PUBLIC_LINK_SLUG),
      public_url: publicLink.public_url,
    },
  };
}

async function findExistingLeadForAuthenticatedUser(params: {
  userId: string;
  email: string | null;
}) {
  const admin = createSupabaseAdminClient();

  const { data: byUser } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("auth_user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byUser?.id) return byUser;

  if (!params.email) return null;

  const { data: byEmail } = await admin
    .from("atendimento_leads")
    .select("*")
    .ilike("email", params.email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!byEmail?.id) return null;

  await admin
    .from("atendimento_leads")
    .update({
      auth_user_id: params.userId,
      email: params.email,
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(byEmail.id));

  return {
    ...byEmail,
    auth_user_id: params.userId,
    email: params.email,
  };
}

export async function ensureAtendimentoLeadForAuthenticatedUser(params: {
  userId: string;
  email?: string | null;
  name?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const normalizedEmail = String(params.email ?? "").trim().toLowerCase() || null;
  const normalizedName = String(params.name ?? "").trim() || null;
  let lead = await findExistingLeadForAuthenticatedUser({
    userId: params.userId,
    email: normalizedEmail,
  });

  if (!lead?.id) {
    const { data: createdLead } = await admin
      .from("atendimento_leads")
      .insert({
        auth_user_id: params.userId,
        full_name: normalizedName,
        email: normalizedEmail,
        origin: "link_publico_atendimento",
        status: "novo_lead",
        funnel_stage: "novo_lead",
        assigned_user_email: ATENDIMENTO_EMAIL,
        unread_count: 0,
        is_new_for_attendant: true,
      })
      .select("*")
      .maybeSingle();

    lead = createdLead;
  } else {
    const nextLeadPatch: Record<string, unknown> = {
      auth_user_id: params.userId,
      updated_at: new Date().toISOString(),
    };
    if (normalizedEmail && !String((lead as any)?.email ?? "").trim()) nextLeadPatch.email = normalizedEmail;
    if (normalizedName && !String((lead as any)?.full_name ?? "").trim()) nextLeadPatch.full_name = normalizedName;

    const shouldUpdateLead = Object.keys(nextLeadPatch).some((key) => key !== "updated_at");
    if (shouldUpdateLead) {
      const { data: refreshedLead } = await admin
        .from("atendimento_leads")
        .update(nextLeadPatch)
        .eq("id", String((lead as any).id))
        .select("*")
        .maybeSingle();
      if (refreshedLead?.id) lead = refreshedLead;
    }
  }

  if (!lead?.id) {
    throw new Error("Não foi possível preparar o seu atendimento.");
  }

  return lead;
}

export async function createAuthenticatedLeadSession(params: {
  userId: string;
  email?: string | null;
  name?: string | null;
  origin?: string | null;
  slug?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const publicLink = await ensureAtendimentoPublicLink(params.origin || undefined);
  const publicSlug = String(params.slug ?? "").trim() || String(publicLink.slug ?? "");
  if (!publicSlug || publicSlug !== ATENDIMENTO_PUBLIC_LINK_SLUG) {
    throw new Error("Link de atendimento inválido.");
  }

  const lead = await ensureAtendimentoLeadForAuthenticatedUser({
    userId: params.userId,
    email: params.email,
    name: params.name,
  });

  const { data: existingConversation } = await admin
    .from("atendimento_conversations")
    .select("*")
    .eq("lead_id", String(lead.id))
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let conversation = existingConversation;
  if (!conversation?.id) {
    const { data: createdConversation } = await admin
      .from("atendimento_conversations")
      .insert({
        lead_id: String(lead.id),
        public_link_id: String(publicLink.id ?? ""),
        channel: "web",
        public_slug: makeConversationSessionSlug(),
        bot_enabled: true,
      })
      .select("*")
      .maybeSingle();
    conversation = createdConversation;
  }

  if (!conversation?.id) {
    throw new Error("Não foi possível preparar a sua conversa.");
  }

  return {
    lead,
    conversation,
    publicLink: {
      slug: String(publicLink.slug ?? ATENDIMENTO_PUBLIC_LINK_SLUG),
      public_url: publicLink.public_url,
    },
  };
}

export async function ensureInitialBotConversationFlow(params: {
  leadId: string;
  conversationId: string;
}) {
  const INITIAL_BOT_TYPING_DELAY_MS = 1500;
  const admin = createSupabaseAdminClient();
  const { data: lead } = await admin
    .from("atendimento_leads")
    .select("full_name")
    .eq("id", params.leadId)
    .maybeSingle();
  const { count: leadCount, error: leadCountError } = await admin
    .from("atendimento_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "lead");

  if (leadCountError) {
    throw new Error(leadCountError.message || "Falha ao verificar mensagens do lead.");
  }
  if (Number(leadCount ?? 0) > 0) {
    return false;
  }

  const { count: botCount, error: botCountError } = await admin
    .from("atendimento_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "bot");

  if (botCountError) {
    throw new Error(botCountError.message || "Falha ao verificar mensagens iniciais.");
  }

  const initialMessages = initialBotMessages({
    userName: String((lead as any)?.full_name ?? "").trim() || null,
  });
  const botCountNum = Number(botCount ?? 0);
  const normalizedInitialMessages = initialMessages.map((m) => String(m ?? "").trim()).filter(Boolean);
  const { data: existingInitialBotMessages, error: existingInitialBotMessagesError } = await admin
    .from("atendimento_messages")
    .select("id, content_text, created_at")
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "bot")
    .in("content_text", normalizedInitialMessages);

  if (existingInitialBotMessagesError) {
    throw new Error(existingInitialBotMessagesError.message || "Falha ao verificar mensagens iniciais.");
  }

  const sentInitialSet = new Set(
    (existingInitialBotMessages ?? [])
      .map((row: any) => String(row?.content_text ?? "").trim())
      .filter(Boolean),
  );

  const duplicateInitialIdsToDelete: string[] = [];
  const byContent = new Map<string, Array<{ id: string; createdAt: string }>>();
  for (const row of existingInitialBotMessages ?? []) {
    const content = String((row as any)?.content_text ?? "").trim();
    const id = String((row as any)?.id ?? "").trim();
    const createdAt = String((row as any)?.created_at ?? "").trim();
    if (!content || !id) continue;
    const next = byContent.get(content) ?? [];
    next.push({ id, createdAt });
    byContent.set(content, next);
  }
  for (const items of byContent.values()) {
    items.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
      return a.id.localeCompare(b.id);
    });
    for (const extra of items.slice(1)) {
      duplicateInitialIdsToDelete.push(extra.id);
    }
  }

  if (duplicateInitialIdsToDelete.length > 0) {
    await admin.from("atendimento_messages").delete().in("id", duplicateInitialIdsToDelete);
  }
  const nextIndex = normalizedInitialMessages.findIndex((message) => !sentInitialSet.has(message));
  const nextContentRaw = nextIndex >= 0 ? normalizedInitialMessages[nextIndex] : "";
  if (nextIndex < 0) {
    return false;
  }

  await new Promise((resolve) => setTimeout(resolve, INITIAL_BOT_TYPING_DELAY_MS));
  const nowIso = new Date().toISOString();
  const nextContent = String(nextContentRaw ?? "").trim();
  if (!nextContent) return false;

  const { data: existingBotMessage } = await admin
    .from("atendimento_messages")
    .select("id")
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "bot")
    .eq("content_text", nextContent)
    .limit(1)
    .maybeSingle();

  if (existingBotMessage?.id) {
    await syncConversationPreview({
      conversationId: params.conversationId,
      contentText: nextContent,
      createdAt: nowIso,
    });
    return false;
  }

  const { data: inserted, error: insertError } = await admin
    .from("atendimento_messages")
    .insert({
      id: buildDeterministicInitialBotMessageId(params.conversationId, nextContent),
      conversation_id: params.conversationId,
      sender_role: "bot",
      content_text: nextContent,
      media_type: "text",
      status: "lida",
      sent_at: nowIso,
      delivered_at: nowIso,
      read_at: nowIso,
    })
    .select("content_text")
    .maybeSingle();

  if (insertError) {
    const code = String((insertError as any)?.code ?? "").trim();
    if (code !== "23505") {
      throw new Error(insertError.message || "Falha ao iniciar fluxo do bot.");
    }
  }

  const { data: duplicatedCurrentMessageRows } = await admin
    .from("atendimento_messages")
    .select("id, created_at")
    .eq("conversation_id", params.conversationId)
    .eq("sender_role", "bot")
    .eq("content_text", nextContent);

  const duplicateCurrentMessageIdsToDelete = (duplicatedCurrentMessageRows ?? [])
    .map((row: any) => ({
      id: String(row?.id ?? "").trim(),
      createdAt: String(row?.created_at ?? "").trim(),
    }))
    .filter((row) => row.id)
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
      return a.id.localeCompare(b.id);
    })
    .slice(1)
    .map((row) => row.id);

  if (duplicateCurrentMessageIdsToDelete.length > 0) {
    await admin.from("atendimento_messages").delete().in("id", duplicateCurrentMessageIdsToDelete);
  }

  if (nextIndex + 1 >= normalizedInitialMessages.length) {
    await admin
      .from("atendimento_leads")
      .update({
        status: "em_atendimento",
        funnel_stage: "aula_experimental_convidada",
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", params.leadId);

    await appendHistoryEvent({
      leadId: params.leadId,
      conversationId: params.conversationId,
      eventType: "stage_changed",
      title: "Fluxo inicial do bot iniciado",
      details: { funnel_stage: "aula_experimental_convidada" },
      actorType: "bot",
    });
  }

  await syncConversationPreview({
    conversationId: params.conversationId,
    contentText: String(inserted?.content_text ?? nextContent),
    createdAt: nowIso,
  });

  return true;
}

export async function syncConversationPreview(params: {
  conversationId: string;
  contentText?: string | null;
  createdAt?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  await admin
    .from("atendimento_conversations")
    .update({
      last_message_preview: summarizePreview(params.contentText ?? ""),
      last_message_at: params.createdAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.conversationId);
}

export async function appendHistoryEvent(params: {
  leadId: string;
  conversationId?: string | null;
  eventType: string;
  title: string;
  details?: Record<string, unknown> | null;
  actorType: "bot" | "lead" | "attendant" | "system";
  actorEmail?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  await admin.from("atendimento_history_events").insert({
    lead_id: params.leadId,
    conversation_id: params.conversationId ?? null,
    event_type: params.eventType,
    title: params.title,
    details: params.details ?? null,
    actor_type: params.actorType,
    actor_email: params.actorEmail ?? null,
  });
}

export async function upsertAtendimentoPresenceSession(params: {
  sessionId: string;
  conversationId: string;
  leadId: string;
  publicSlug: string;
}) {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  await admin.from("atendimento_presence_sessions").upsert(
    {
      id: params.sessionId,
      conversation_id: params.conversationId,
      lead_id: params.leadId,
      public_slug: params.publicSlug,
      updated_at: nowIso,
    },
    { onConflict: "id" },
  );

  await admin
    .from("atendimento_conversations")
    .update({
      offline_message_notification_sent: false,
      offline_message_notification_sent_at: null,
    })
    .eq("id", params.conversationId);
}

export async function removeAtendimentoPresenceSession(sessionId: string) {
  if (!String(sessionId ?? "").trim()) return;
  const admin = createSupabaseAdminClient();
  await admin.from("atendimento_presence_sessions").delete().eq("id", sessionId);
}

export async function getAtendimentoActivePresenceCount(conversationId: string) {
  const admin = createSupabaseAdminClient();
  const activeSinceIso = new Date(Date.now() - ATENDIMENTO_PRESENCE_SESSION_TTL_MS).toISOString();
  await admin
    .from("atendimento_presence_sessions")
    .delete()
    .eq("conversation_id", conversationId)
    .lt("updated_at", activeSinceIso);
  const { count } = await admin
    .from("atendimento_presence_sessions")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .gte("updated_at", activeSinceIso);
  return Number(count ?? 0);
}

export async function getAuthenticatedAtendimentoConversationAccess(publicSlug: string) {
  const auth = await requireAuthenticatedAtendimentoParticipant();
  if (!auth.ok || !auth.user?.id) {
    return { ok: false as const, status: 401, error: "unauthorized" };
  }

  const admin = createSupabaseAdminClient();
  const { data: conversation } = await admin
    .from("atendimento_conversations")
    .select("id, lead_id, public_slug, bot_enabled")
    .eq("public_slug", publicSlug)
    .maybeSingle();

  if (!conversation?.id) {
    return { ok: false as const, status: 404, error: "not_found" };
  }

  const { data: lead } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("id", String(conversation.lead_id))
    .maybeSingle();

  if (!lead?.id) {
    return { ok: false as const, status: 404, error: "lead_not_found" };
  }

  if (String((lead as any).auth_user_id ?? "") !== auth.user.id) {
    return { ok: false as const, status: 403, error: "forbidden" };
  }

  return { ok: true as const, auth, admin, conversation, lead };
}

export async function getAtendimentoConversationAccessForAttendant(conversationId: string) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok || !auth.user?.email) {
    return { ok: false as const, status: 403, error: "forbidden" };
  }

  const admin = createSupabaseAdminClient();
  const { data: conversation } = await admin
    .from("atendimento_conversations")
    .select("id, lead_id, public_slug, offline_message_notification_sent, offline_message_notification_sent_at")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversation?.id) {
    return { ok: false as const, status: 404, error: "not_found" };
  }

  return { ok: true as const, auth, admin, conversation };
}

export async function getAtendimentoLeadFiles(leadId: string) {
  const admin = createSupabaseAdminClient();
  const { data: conversation } = await admin
    .from("atendimento_conversations")
    .select("id")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!conversation?.id) {
    return [];
  }

  const { data: files } = await admin
    .from("atendimento_messages")
    .select("id, conversation_id, sender_role, content_text, media_type, media_url, mime_type, file_name, file_size_bytes, created_at")
    .eq("conversation_id", String(conversation.id))
    .not("media_url", "is", null)
    .order("created_at", { ascending: false });

  return (files ?? []).map((file) => ({
    ...(file as any),
    lead_id: leadId,
  }));
}

async function ensureAtendimentoFilesBucket() {
  const admin = createSupabaseAdminClient();
  const { data: buckets, error: bucketsError } = await admin.storage.listBuckets();
  if (!bucketsError && buckets?.some((bucket) => String(bucket.name ?? bucket.id ?? "") === ATENDIMENTO_FILES_BUCKET)) {
    return;
  }

  const { error: createError } = await admin.storage.createBucket(ATENDIMENTO_FILES_BUCKET, {
    public: true,
    fileSizeLimit: 262144000,
    allowedMimeTypes: [...ATENDIMENTO_ALLOWED_UPLOAD_MIME_TYPES],
  });

  if (createError) {
    const message = String(createError.message ?? "").toLowerCase();
    if (!message.includes("already exists") && !message.includes("duplicate")) {
      throw createError;
    }
  }
}

export async function uploadAtendimentoFileToStorage(params: {
  conversationId: string;
  senderRole: "lead" | "attendant";
  file: File;
}) {
  const mimeType = String(params.file.type ?? "").trim().toLowerCase();
  const mediaType = getAtendimentoMediaTypeFromMimeType(mimeType);
  if (!mediaType) {
    throw new Error("unsupported_file_type");
  }

  const admin = createSupabaseAdminClient();
  await ensureAtendimentoFilesBucket();
  const storagePath = buildAtendimentoStoragePath({
    conversationId: params.conversationId,
    senderRole: params.senderRole,
    originalFileName: params.file.name,
  });
  const arrayBuffer = await params.file.arrayBuffer();
  let { error } = await admin.storage.from(ATENDIMENTO_FILES_BUCKET).upload(storagePath, arrayBuffer, {
    contentType: mimeType,
    upsert: false,
  });

  if (error && String(error.message ?? "").toLowerCase().includes("bucket not found")) {
    await ensureAtendimentoFilesBucket();
    const retry = await admin.storage.from(ATENDIMENTO_FILES_BUCKET).upload(storagePath, arrayBuffer, {
      contentType: mimeType,
      upsert: false,
    });
    error = retry.error;
  }

  if (error) {
    throw new Error(error.message || "upload_failed");
  }

  const { data } = admin.storage.from(ATENDIMENTO_FILES_BUCKET).getPublicUrl(storagePath);

  return {
    media_url: String(data.publicUrl ?? "").trim(),
    media_type: mediaType,
    mime_type: mimeType || null,
    file_name: String(params.file.name ?? "").trim() || null,
    file_size_bytes: Number(params.file.size ?? 0) || 0,
    storage_path: storagePath,
  };
}

export async function findLeadByPhone(params: { phone: string; userId?: string | null }) {
  const admin = createSupabaseAdminClient();
  const normalizedSearch = normalizePhoneDigitsOnly(params.phone);
  if (!normalizedSearch) return null;

  const { data: byAssigned } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("assigned_user_email", ATENDIMENTO_EMAIL)
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (byAssigned ?? []) as any[];
  for (const row of rows) {
    if (phoneMatches(row?.phone, normalizedSearch)) {
      return row as any;
    }
  }

  return null;
}

export async function findLeadConversationByChannel(params: {
  leadId: string;
  channel: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("atendimento_conversations")
    .select("*")
    .eq("lead_id", String(params.leadId))
    .eq("channel", String(params.channel))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as any) ?? null;
}

export async function ensureWhatsAppLeadAndConversation(params: {
  phone: string;
  userId: string;
  firstNameFromMessage?: string | null;
  initialState?: string | null;
  initialStateNormalized?: string | null;
  initialTimezone?: string | null;
  initialCountry?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const normalizedPhone = normalizePhoneDigitsOnly(params.phone);
  if (!normalizedPhone || !isValidWhatsAppUserPhone(normalizedPhone)) {
    throw new Error(
      `Telefone informado nao corresponde a um usuario WhatsApp valido: ${normalizedPhone ? "len=" + normalizedPhone.length : "empty"}`,
    );
  }
  const publicLink = await ensureAtendimentoPublicLink();

  let lead = await findLeadByPhone({ phone: normalizedPhone, userId: params.userId });

  if (!lead?.id) {
    const nameRaw = String(params.firstNameFromMessage ?? "").trim() || null;
    const initialState = params.initialState ? String(params.initialState).trim() : null;
    const initialCountry = params.initialCountry ? String(params.initialCountry).trim() : null;
    const initialTimezone = params.initialTimezone ? String(params.initialTimezone).trim() : null;

    const leadPatch: Record<string, unknown> = {
      phone: normalizedPhone,
      origin: "whatsapp_trafego_pago",
      status: "novo_lead",
      funnel_stage: "novo_lead",
      assigned_user_email: ATENDIMENTO_EMAIL,
      unread_count: 0,
      is_new_for_attendant: true,
      ...(nameRaw ? { full_name: nameRaw } : {}),
      ...(initialState ? { state: initialState } : {}),
      ...(initialCountry ? { country: initialCountry } : {}),
      ...(initialTimezone ? { timezone: initialTimezone } : {}),
    };

    const { data: createdLead } = await admin
      .from("atendimento_leads")
      .insert(leadPatch as any)
      .select("*")
      .maybeSingle();

    lead = createdLead;
  } else {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (!String((lead as any)?.phone ?? "").trim()) {
      updates.phone = normalizedPhone;
    }
    if (params.initialState && !String((lead as any)?.state ?? "").trim()) {
      updates.state = String(params.initialState).trim();
    }
    if (params.initialTimezone && !String((lead as any)?.timezone ?? "").trim()) {
      updates.timezone = String(params.initialTimezone).trim();
    }
    if (params.initialCountry && !String((lead as any)?.country ?? "").trim()) {
      updates.country = String(params.initialCountry).trim();
    }
    if (Object.keys(updates).length > 1) {
      const { data: refreshed } = await admin
        .from("atendimento_leads")
        .update(updates as any)
        .eq("id", String((lead as any).id))
        .select("*")
        .maybeSingle();
      if (refreshed) lead = refreshed;
    }
  }

  if (!(lead as any)?.id) {
    throw new Error("Não foi possível preparar o lead para atendimento via WhatsApp.");
  }

  let conversation = await findLeadConversationByChannel({
    leadId: String((lead as any).id),
    channel: "whatsapp",
  });

  if (!conversation?.id) {
    const { data: createdConversation } = await admin
      .from("atendimento_conversations")
      .insert({
        lead_id: String((lead as any).id),
        public_link_id: String(publicLink.id ?? ""),
        channel: "whatsapp",
        public_slug: makeConversationSessionSlug(),
        bot_enabled: true,
      })
      .select("*")
      .maybeSingle();
    conversation = createdConversation;
  }

  if (!conversation?.id) {
    throw new Error("Não foi possível preparar a conversa para atendimento via WhatsApp.");
  }

  return {
    lead: lead as any,
    conversation: conversation as any,
    publicLink: {
      slug: String(publicLink.slug ?? ATENDIMENTO_PUBLIC_LINK_SLUG),
      public_url: publicLink.public_url,
    },
  };
}

export async function hasAnyBotMessage(params: { conversationId: string }) {
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin
    .from("atendimento_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", String(params.conversationId))
    .eq("sender_role", "bot");

  if (error) {
    throw new Error(error.message || "Falha ao verificar mensagens do bot.");
  }
  return Number(count ?? 0) > 0;
}
