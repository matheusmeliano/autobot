"use server";

import fs from "node:fs";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BRAZIL_TIMEZONES, zonedDateTimeToUtcIso } from "@/lib/timezone";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  localDateInTimeZone,
  monthlyRecurrenceLimitMinDate,
  nextMonthlyIso,
  shouldContinueMonthlyRecurrence,
} from "@/lib/recurrence";
import { syncDebtorChargeStatus } from "@/lib/debtorChargeStatus";

// #region debug-point extra-send-manual-bootstrap
const __dbgEnvPath = ".dbg/extra-scheduled-send.env";
const __dbgEnvRaw = fs.existsSync(__dbgEnvPath) ? fs.readFileSync(__dbgEnvPath, "utf8") : "";
const __dbgMap = Object.fromEntries(
  __dbgEnvRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("=");
      return idx >= 0 ? [line.slice(0, idx), line.slice(idx + 1)] : [line, ""];
    }),
);
const __dbgUrl = __dbgMap.DEBUG_SERVER_URL;
const __dbgSession = __dbgMap.DEBUG_SESSION_ID;
const __dbg = (traceId: string, hypothesisId: string, msg: string, data: Record<string, unknown>) => {
  if (!__dbgUrl || !__dbgSession) return;
  fetch(__dbgUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: __dbgSession,
      runId: "pre",
      hypothesisId,
      traceId,
      location: "app/app/agenda/actions",
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

function prereqError(params: {
  missingTimeZone: boolean;
  missingWhatsApp: boolean;
  context: "criar agendamentos" | "editar agendamentos" | "disparar agendamentos";
}) {
  if (params.missingTimeZone && params.missingWhatsApp) {
    return `Selecione e salve seu fuso horário em Configurações e configure seu WhatsApp na página WhatsApp antes de ${params.context}.`;
  }
  if (params.missingTimeZone) {
    return `Selecione e salve seu fuso horário em Configurações antes de ${params.context}.`;
  }
  if (params.missingWhatsApp) {
    return `Configure seu WhatsApp na página WhatsApp antes de ${params.context}.`;
  }
  return null;
}

function normalizePhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55")) return d;
  if (d.length === 11) return `55${d}`;
  return d;
}

function applyTemplate(text: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), text);
}

function formatBRL(value: unknown) {
  if (value === null || value === undefined) return "";
  const n = typeof value === "number" ? value : Number(String(value));
  if (Number.isNaN(n)) return "";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function formatDateBR(value: unknown) {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(d);
}

type MonthlyCycleSchedule = {
  day: number;
  time: string;
};

function parseMonthlyCycleSchedule(row: any): MonthlyCycleSchedule | null {
  const day = Number(row?.recurrence_day ?? "");
  const time = String(row?.recurrence_time ?? "");
  if (!Number.isFinite(day) || day < 1 || !/^\d{2}:\d{2}$/.test(time)) return null;
  return { day, time };
}

async function validateMonthlyRecurrenceLimit(params: {
  currentUtcIso: string;
  timeZone: string;
  currentSchedule: MonthlyCycleSchedule;
  recurrenceUntil?: string | null;
}) {
  if (!params.recurrenceUntil) return null;

  const currentDate = localDateInTimeZone(params.currentUtcIso, params.timeZone);
  if (params.recurrenceUntil < currentDate) {
    return "A data final da cobrança mensal deve ser igual ou posterior à cobrança atual.";
  }

  const minDate = monthlyRecurrenceLimitMinDate({
    currentUtcIso: params.currentUtcIso,
    timeZone: params.timeZone,
  });

  if (minDate && params.recurrenceUntil < minDate) {
    return `A data final da cobrança mensal deve ser no mínimo ${formatDateBR(minDate)}, sempre a partir do próximo mês.`;
  }

  return null;
}

async function sendZapiText(params: {
  instance_id: string;
  token: string;
  client_token?: string | null;
  phone: string;
  message: string;
}) {
  const body = JSON.stringify({ phone: normalizePhone(params.phone), message: params.message });
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

const createSchema = z.object({
  debtor_id: z.string().uuid(),
  template_pending_id: z.string().uuid().optional(),
  template_overdue_id: z.string().uuid().optional(),
  data_envio_date: z.string().min(10),
  data_envio_time: z.string().min(4),
  recurrence: z.enum(["none", "monthly"]).optional(),
  recurrence_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.string().optional(),
});

const updateSchema = createSchema.extend({
  id: z.string().uuid(),
});

const updateRecurrenceUntilSchema = z.object({
  id: z.string().uuid(),
  recurrence_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

function validateRecurrenceUntil(params: {
  recurrence: "none" | "monthly";
  recurrenceUntil?: string;
  currentDate: string;
}) {
  if (params.recurrence !== "monthly") return null;
  if (!params.recurrenceUntil) return null;
  if (params.recurrenceUntil < params.currentDate) {
    return "A data final da cobrança mensal deve ser igual ou posterior à primeira cobrança.";
  }
  return null;
}

export async function createScheduleAction(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const [profileRes, waRes] = await Promise.all([
    supabase.from("profiles").select("timezone").maybeSingle(),
    supabase.from("whatsapp_instances").select("instance_id, token, status").maybeSingle(),
  ]);
  const tzRaw = (profileRes as any)?.data?.timezone ?? (profileRes as any)?.timezone;
  const timeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? tzRaw : null;
  const wa = (waRes as any)?.data ?? null;
  const waStatus = String(wa?.status ?? "").toLowerCase();
  const whatsappConfigured = Boolean(
    wa?.instance_id && wa?.token && (waStatus === "configured" || waStatus === "connected"),
  );
  const msg = prereqError({
    missingTimeZone: !timeZone,
    missingWhatsApp: !whatsappConfigured,
    context: "criar agendamentos",
  });
  if (msg) return { ok: false, error: msg };

  let dataEnvioIso: string;
  try {
    dataEnvioIso = zonedDateTimeToUtcIso({
      date: parsed.data.data_envio_date,
      time: parsed.data.data_envio_time,
      timeZone,
    });
  } catch {
    return { ok: false, error: "Data/hora inválida." };
  }

  const nowRounded = new Date();
  nowRounded.setSeconds(0, 0);
  const minAllowed = nowRounded.getTime() + 3 * 60 * 1000;
  if (new Date(dataEnvioIso).getTime() < minAllowed) {
    return { ok: false, error: "Escolha um horário futuro válido (mínimo +3 minutos)." };
  }

  const recurrence = parsed.data.recurrence ?? "none";
  const recurrenceUntil = parsed.data.recurrence_until;
  const recurrenceValidation = validateRecurrenceUntil({
    recurrence,
    recurrenceUntil,
    currentDate: parsed.data.data_envio_date,
  });
  if (recurrenceValidation) return { ok: false, error: recurrenceValidation };
  const recurrenceDay = Number(parsed.data.data_envio_date.split("-")[2] ?? "");
  const recurrenceTime = parsed.data.data_envio_time;
  if (recurrence === "monthly") {
    const recurrenceLimitValidation = await validateMonthlyRecurrenceLimit({
      currentUtcIso: dataEnvioIso,
      timeZone,
      currentSchedule: {
        day: Number.isFinite(recurrenceDay) ? recurrenceDay : 1,
        time: recurrenceTime,
      },
      recurrenceUntil: recurrenceUntil ?? null,
    });
    if (recurrenceLimitValidation) return { ok: false, error: recurrenceLimitValidation };
  }

  const { error } = await supabase.from("schedules").insert({
    debtor_id: parsed.data.debtor_id,
    template_id: parsed.data.template_pending_id ?? null,
    template_pending_id: parsed.data.template_pending_id ?? null,
    template_overdue_id: parsed.data.template_overdue_id ?? null,
    data_envio: dataEnvioIso,
    charge_due_at: dataEnvioIso,
    recurrence,
    schedule_timezone: recurrence === "monthly" ? timeZone : null,
    recurrence_day: recurrence === "monthly" ? (Number.isFinite(recurrenceDay) ? recurrenceDay : null) : null,
    recurrence_time: recurrence === "monthly" ? recurrenceTime : null,
    recurrence_until: recurrence === "monthly" ? recurrenceUntil ?? null : null,
    status: parsed.data.status ?? "agendado",
  });
  if (error) return { ok: false, error: error.message };
  await syncDebtorChargeStatus(createSupabaseAdminClient(), userId, parsed.data.debtor_id);
  return { ok: true };
}

export async function updateScheduleAction(input: unknown) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { id, ...data } = parsed.data;
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const [profileRes, waRes] = await Promise.all([
    supabase.from("profiles").select("timezone").maybeSingle(),
    supabase.from("whatsapp_instances").select("instance_id, token, status").maybeSingle(),
  ]);
  const tzRaw = (profileRes as any)?.data?.timezone ?? (profileRes as any)?.timezone;
  const timeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? tzRaw : null;
  const wa = (waRes as any)?.data ?? null;
  const waStatus = String(wa?.status ?? "").toLowerCase();
  const whatsappConfigured = Boolean(
    wa?.instance_id && wa?.token && (waStatus === "configured" || waStatus === "connected"),
  );
  const msg = prereqError({
    missingTimeZone: !timeZone,
    missingWhatsApp: !whatsappConfigured,
    context: "editar agendamentos",
  });
  if (msg) return { ok: false, error: msg };

  let dataEnvioIso: string;
  try {
    dataEnvioIso = zonedDateTimeToUtcIso({
      date: data.data_envio_date,
      time: data.data_envio_time,
      timeZone,
    });
  } catch {
    return { ok: false, error: "Data/hora inválida." };
  }

  const nowRounded = new Date();
  nowRounded.setSeconds(0, 0);
  const minAllowed = nowRounded.getTime() + 3 * 60 * 1000;
  if (new Date(dataEnvioIso).getTime() < minAllowed) {
    return { ok: false, error: "Escolha um horário futuro válido (mínimo +3 minutos)." };
  }

  const recurrence = (data as any).recurrence ?? "none";
  const recurrenceUntil = data.recurrence_until;
  const recurrenceValidation = validateRecurrenceUntil({
    recurrence,
    recurrenceUntil,
    currentDate: data.data_envio_date,
  });
  if (recurrenceValidation) return { ok: false, error: recurrenceValidation };
  const recurrenceDay = Number(String(data.data_envio_date ?? "").split("-")[2] ?? "");
  const recurrenceTime = String(data.data_envio_time ?? "");
  if (recurrence === "monthly") {
    const recurrenceLimitValidation = await validateMonthlyRecurrenceLimit({
      currentUtcIso: dataEnvioIso,
      timeZone,
      currentSchedule: {
        day: Number.isFinite(recurrenceDay) ? recurrenceDay : 1,
        time: recurrenceTime,
      },
      recurrenceUntil: recurrenceUntil ?? null,
    });
    if (recurrenceLimitValidation) return { ok: false, error: recurrenceLimitValidation };
  }

  const { data: previous } = await supabase
    .from("schedules")
    .select("debtor_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("schedules")
    .update({
      debtor_id: data.debtor_id,
      template_id: data.template_pending_id ?? null,
      template_pending_id: data.template_pending_id ?? null,
      template_overdue_id: data.template_overdue_id ?? null,
      data_envio: dataEnvioIso,
      charge_due_at: dataEnvioIso,
      recurrence,
      schedule_timezone: recurrence === "monthly" ? timeZone : null,
      recurrence_day: recurrence === "monthly" ? (Number.isFinite(recurrenceDay) ? recurrenceDay : null) : null,
      recurrence_time: recurrence === "monthly" ? recurrenceTime : null,
      recurrence_until: recurrence === "monthly" ? recurrenceUntil ?? null : null,
      status: data.status ?? "agendado",
      first_sent_at: null,
      last_sent_at: null,
      retry_attempts: 0,
      payment_received_at: null,
      closed_at: null,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  const admin = createSupabaseAdminClient();
  await syncDebtorChargeStatus(admin, userId, data.debtor_id);
  const previousDebtorId = String((previous as any)?.debtor_id ?? "");
  if (previousDebtorId && previousDebtorId !== data.debtor_id) {
    await syncDebtorChargeStatus(admin, userId, previousDebtorId);
  }
  return { ok: true };
}

export async function deleteScheduleAction(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };
  const { data: schedule } = await supabase.from("schedules").select("debtor_id").eq("id", id).maybeSingle();
  const { error } = await supabase.from("schedules").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  const debtorId = String((schedule as any)?.debtor_id ?? "");
  if (debtorId) {
    await syncDebtorChargeStatus(createSupabaseAdminClient(), userId, debtorId);
  }
  return { ok: true };
}

export async function updateScheduleRecurrenceUntilAction(input: unknown) {
  const parsed = updateRecurrenceUntilSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const admin = createSupabaseAdminClient();
  const { data: schedule, error } = await admin
    .from("schedules")
    .select("id, user_id, debtor_id, data_envio, recurrence, schedule_timezone, recurrence_day, recurrence_time")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!schedule?.id) return { ok: false, error: "Agendamento não encontrado." };
  if (String((schedule as any).user_id) !== userId) return { ok: false, error: "Sem permissão." };
  if (String((schedule as any).recurrence ?? "none") !== "monthly") {
    return { ok: false, error: "Essa opção está disponível apenas para agendamentos mensais." };
  }

  const recurrenceLimitValidation = await validateMonthlyRecurrenceLimit({
    currentUtcIso: String((schedule as any).data_envio),
    timeZone: String((schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo",
    currentSchedule:
      parseMonthlyCycleSchedule(schedule) ??
      {
        day: Number(localDateInTimeZone(String((schedule as any).data_envio), String((schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo").slice(-2)),
        time: "00:00",
      },
    recurrenceUntil: parsed.data.recurrence_until ?? null,
  });
  if (recurrenceLimitValidation) {
    return { ok: false, error: recurrenceLimitValidation };
  }

  const { error: updateError } = await admin
    .from("schedules")
    .update({ recurrence_until: parsed.data.recurrence_until ?? null })
    .eq("id", parsed.data.id);
  if (updateError) return { ok: false, error: updateError.message };

  await admin.from("logs").insert({
    user_id: userId,
    tipo: "agenda_recorrencia_final",
    descricao: parsed.data.recurrence_until
      ? `Data final da cobrança mensal definida para ${parsed.data.recurrence_until} no agendamento ${parsed.data.id}`
      : `Data final da cobrança mensal removida do agendamento ${parsed.data.id}`,
  });

  return { ok: true };
}

export async function triggerScheduleNowAction(id: string) {
  const __dbgTraceId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // #region debug-point extra-send-manual-entry
  __dbg(__dbgTraceId, "D", "manual-trigger-entry", { id });
  // #endregion
  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const [profileRes, waRes] = await Promise.all([
    supabase.from("profiles").select("timezone").maybeSingle(),
    supabase.from("whatsapp_instances").select("instance_id, token, status").maybeSingle(),
  ]);
  const tzRaw = (profileRes as any)?.data?.timezone ?? (profileRes as any)?.timezone;
  const timeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? tzRaw : null;
  const wa = (waRes as any)?.data ?? null;
  const waStatus = String(wa?.status ?? "").toLowerCase();
  const whatsappConfigured = Boolean(
    wa?.instance_id && wa?.token && (waStatus === "configured" || waStatus === "connected"),
  );
  const msg = prereqError({
    missingTimeZone: !timeZone,
    missingWhatsApp: !whatsappConfigured,
    context: "disparar agendamentos",
  });
  if (msg) return { ok: false, error: msg };

  const admin = createSupabaseAdminClient();
  const { data: schedule, error } = await admin
    .from("schedules")
    .select(
      "id, user_id, debtor_id, template_id, template_pending_id, template_overdue_id, data_envio, status, recurrence, schedule_timezone, recurrence_day, recurrence_time, recurrence_until, first_sent_at, retry_attempts, debtors(nome, telefone, pix_key, valor, vencimento), pending_template:message_templates!schedules_template_pending_id_fkey(conteudo), overdue_template:message_templates!schedules_template_overdue_id_fkey(conteudo)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!schedule?.id) return { ok: false, error: "Agendamento não encontrado." };
  if (String((schedule as any).user_id) !== userId) return { ok: false, error: "Sem permissão." };

  // #region debug-point extra-send-manual-schedule
  __dbg(__dbgTraceId, "B", "manual-trigger-loaded-schedule", {
    scheduleId: String((schedule as any).id ?? ""),
    userId,
    debtorId: String((schedule as any).debtor_id ?? ""),
    status: String((schedule as any).status ?? ""),
    recurrence: String((schedule as any).recurrence ?? ""),
    scheduledFor: String((schedule as any).data_envio ?? ""),
  });
  // #endregion

  const currentStatus = String((schedule as any).status ?? "");
  if (currentStatus === "executando") {
    return { ok: false, error: "Esse agendamento já está sendo processado." };
  }
  if (["pendente", "suspeita_de_pagamento", "pago", "executado"].includes(currentStatus)) {
    return { ok: false, error: "Esse agendamento não pode ser reenviado manualmente agora." };
  }

  const { data: locked, error: lockErr } = await admin
    .from("schedules")
    .update({ status: "executando" })
    .eq("id", String((schedule as any).id))
    .in("status", ["agendado", "atrasado", "pausado"])
    .select("id")
    .maybeSingle();

  if (lockErr) return { ok: false, error: lockErr.message };
  if (!locked?.id) return { ok: false, error: "Não foi possível iniciar o disparo." };

  try {
    const debtor = (schedule as any).debtors ?? null;
    const pendingTemplate = (schedule as any).pending_template ?? null;
    const overdueTemplate = (schedule as any).overdue_template ?? null;
    const scheduleId = String((schedule as any).id);
    const scheduledFor = String((schedule as any).data_envio ?? new Date().toISOString());
    const sourceStatus = currentStatus === "atrasado" ? "atrasado" : "pendente";

    const debtorPhone = String(debtor?.telefone ?? "");
    const templateText = String(
      sourceStatus === "atrasado" ? overdueTemplate?.conteudo ?? "" : pendingTemplate?.conteudo ?? "",
    );
    if (!debtorPhone) throw new Error("Cliente sem telefone");
    if (!templateText) {
      throw new Error(
        sourceStatus === "atrasado"
          ? "Template atrasado sem conteúdo."
          : "Template pendente sem conteúdo.",
      );
    }

    const { data: wa, error: waErr } = await admin
      .from("whatsapp_instances")
      .select("instance_id, token, client_token, status")
      .eq("user_id", userId)
      .maybeSingle();

    if (waErr) throw new Error(waErr.message);
    if (!wa?.instance_id || !wa?.token) throw new Error("WhatsApp não configurado");
    if ((wa.status ?? "").toLowerCase() !== "configured" && (wa.status ?? "").toLowerCase() !== "connected") {
      throw new Error("WhatsApp desconectado");
    }

    const { data: existingRun } = await admin
      .from("schedule_runs")
      .select("id")
      .eq("schedule_id", scheduleId)
      .eq("scheduled_for", scheduledFor)
      .eq("status", "executado")
      .maybeSingle();

    if (existingRun?.id) {
      // #region debug-point extra-send-manual-existing-run
      __dbg(__dbgTraceId, "D", "manual-existing-run-skip-send", {
        scheduleId,
        scheduledFor,
        status: "pendente",
      });
      // #endregion
      await admin
        .from("schedules")
        .update({
          status: "pendente",
          first_sent_at: String((schedule as any).first_sent_at ?? "") || new Date().toISOString(),
          last_sent_at: new Date().toISOString(),
        })
        .eq("id", scheduleId);
      await syncDebtorChargeStatus(admin, userId, String((schedule as any).debtor_id ?? ""));
      return { ok: true };
    }

    const message = applyTemplate(templateText, {
      nome: String(debtor?.nome ?? ""),
      pix: String(debtor?.pix_key ?? ""),
      valor: formatBRL(debtor?.valor),
      vencimento: formatDateBR(debtor?.vencimento),
    });

    // #region debug-point extra-send-manual-before-send
    __dbg(__dbgTraceId, "D", "manual-before-send", {
      scheduleId,
      scheduledFor,
      debtorPhone,
      normalizedPhone: normalizePhone(debtorPhone),
      messagePreview: message.slice(0, 120),
      nextStatus: "pendente",
      templateSource: sourceStatus,
    });
    // #endregion
    await sendZapiText({
      instance_id: wa.instance_id,
      token: wa.token,
      client_token: wa.client_token,
      phone: debtorPhone,
      message,
    });

    const { error: runError } = await admin.from("schedule_runs").insert({
      user_id: userId,
      schedule_id: scheduleId,
      scheduled_for: scheduledFor,
      executed_at: new Date().toISOString(),
      status: "executado",
    });
    if (runError) throw new Error(runError.message);

    const { error: updateError } = await admin
      .from("schedules")
      .update({
        status: "pendente",
        first_sent_at: String((schedule as any).first_sent_at ?? "") || new Date().toISOString(),
        last_sent_at: new Date().toISOString(),
        retry_attempts: Number((schedule as any).retry_attempts ?? 0) + 1,
      })
      .eq("id", scheduleId);
    if (updateError) throw new Error(updateError.message);
    await syncDebtorChargeStatus(admin, userId, String((schedule as any).debtor_id ?? ""));

    await admin.from("logs").insert({
      user_id: userId,
      tipo: "agenda_executada",
      descricao: `Agendamento executado: ${scheduleId}`,
    });
    // #region debug-point extra-send-manual-success
    __dbg(__dbgTraceId, "D", "manual-send-success", {
      scheduleId,
      scheduledFor,
      nextStatus: "pendente",
    });
    // #endregion
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.message ?? "Erro desconhecido");
    const recurrence = String((schedule as any)?.recurrence ?? "none");
    const scheduleId = String((schedule as any)?.id ?? "");
    const scheduledFor = String((schedule as any)?.data_envio ?? new Date().toISOString());
    const wasExecuted = await admin
      .from("schedule_runs")
      .select("id")
      .eq("schedule_id", scheduleId)
      .eq("scheduled_for", scheduledFor)
      .eq("status", "executado")
      .maybeSingle();
    if (recurrence === "monthly" && !wasExecuted.data?.id) {
      await admin.from("schedule_runs").insert({
        user_id: userId,
        schedule_id: scheduleId,
        scheduled_for: scheduledFor,
        executed_at: new Date().toISOString(),
        status: "falha",
        error: msg,
      });
    }
    await admin.from("logs").insert({
      user_id: userId,
      tipo: "agenda_falha",
      descricao: `Falha ao executar agendamento ${scheduleId}: ${msg}`,
    });
    if (!wasExecuted.data?.id) {
      await admin.from("schedules").update({ status: currentStatus === "atrasado" ? "atrasado" : "agendado" }).eq("id", scheduleId);
    }
    // #region debug-point extra-send-manual-error
    __dbg(__dbgTraceId, "D", "manual-send-error", {
      scheduleId,
      scheduledFor,
      error: msg,
      recurrence,
      wasExecuted: Boolean(wasExecuted.data?.id),
    });
    // #endregion
    return { ok: false, error: msg };
  }
}

export async function markSchedulePaidAction(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const admin = createSupabaseAdminClient();
  const { data: schedule, error } = await admin
    .from("schedules")
    .select("id, user_id, debtor_id, data_envio, charge_due_at, status, recurrence, schedule_timezone, recurrence_day, recurrence_time, recurrence_until")
    .eq("id", id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!schedule?.id) return { ok: false, error: "Agendamento não encontrado." };
  if (String((schedule as any).user_id) !== userId) return { ok: false, error: "Sem permissão." };

  const currentStatus = String((schedule as any).status ?? "");
  if (currentStatus === "executando") {
    return { ok: false, error: "Esse agendamento está sendo processado no momento." };
  }

  const recurrence = String((schedule as any).recurrence ?? "none");
  const nowIso = new Date().toISOString();
  let updatePayload: Record<string, unknown>;
  if (recurrence === "monthly") {
    const nextIso = nextMonthlyIso({
      fromUtcIso: String((schedule as any).charge_due_at ?? (schedule as any).data_envio),
      timeZone: String((schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo",
      day: Number((schedule as any).recurrence_day ?? 1),
      time: String((schedule as any).recurrence_time ?? "") || "00:00",
    });
    const shouldContinue = shouldContinueMonthlyRecurrence({
      nextUtcIso: nextIso,
      recurrenceUntil: String((schedule as any).recurrence_until ?? "") || null,
      timeZone: String((schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo",
    });
    updatePayload = shouldContinue
      ? {
          status: "agendado",
          data_envio: nextIso,
          charge_due_at: nextIso,
          first_sent_at: null,
          last_sent_at: null,
          retry_attempts: 0,
          closed_at: null,
          payment_received_at: nowIso,
        }
      : {
          status: "pago",
          payment_received_at: nowIso,
          closed_at: nowIso,
        };
  } else {
    updatePayload = {
      status: "pago",
      payment_received_at: nowIso,
      closed_at: nowIso,
    };
  }

  const { error: updateError } = await admin
    .from("schedules")
    .update(updatePayload)
    .eq("id", String((schedule as any).id));
  if (updateError) return { ok: false, error: updateError.message };
  await syncDebtorChargeStatus(admin, userId, String((schedule as any).debtor_id ?? ""));

  await admin.from("logs").insert({
    user_id: userId,
    tipo: "agenda_pagamento_manual",
    descricao: `Pagamento marcado manualmente como realizado para o agendamento ${String((schedule as any).id)}`,
  });

  return { ok: true };
}
