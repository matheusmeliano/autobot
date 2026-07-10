"use server";

import fs from "node:fs";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BRAZIL_TIMEZONES, zonedDateTimeToUtcIso } from "@/lib/timezone";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_RETRY_AUTO_CLOSE_DAYS,
  DEFAULT_RETRY_INTERVAL_DAYS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_TIME,
  nextSameDayRetryUtcIso,
  normalizeRetryConfig,
  normalizeRetryWeekdays,
  shiftFirstChargeFromWeekendUtcIso,
} from "@/lib/chargeRetry";
import {
  localDateInTimeZone,
  MAX_MONTHLY_SCHEDULES_PER_DEBTOR,
  MAX_YEARLY_RECURRENCE_OCCURRENCES,
  monthlyRecurrenceLimitMinDate,
  recurrenceLimitMaxDate,
  shouldContinueRecurringRecurrence,
} from "@/lib/recurrence";
import { getScheduleChargeAmount, nextRecurringIsoAfterSettlement } from "@/lib/chargeAccumulation";
import { deriveAgendarVisualStatus } from "@/lib/agendarStatus";
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
  const raw = String(phone ?? "").trim();
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (raw.startsWith("+")) return d;
  if (d.startsWith("55")) return d;
  if (d.startsWith("1") && d.length === 11) return d;
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

async function debtorSkipsWeekendsOnFirstCharge(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, debtorId: string) {
  const { data } = await supabase
    .from("debtors")
    .select("skip_weekends_on_first_charge")
    .eq("id", debtorId)
    .maybeSingle();
  return Boolean((data as any)?.skip_weekends_on_first_charge);
}

async function countExecutedRunsOnLocalDate(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  scheduleId: string;
  timeZone: string;
  localDate: string;
}) {
  const { data } = await params.admin
    .from("schedule_runs")
    .select("executed_at")
    .eq("schedule_id", params.scheduleId)
    .eq("status", "executado")
    .order("executed_at", { ascending: false })
    .limit(50);

  return (data ?? []).filter((run: any) => {
    const executedAt = String(run?.executed_at ?? "");
    return executedAt && localDateInTimeZone(executedAt, params.timeZone) === params.localDate;
  }).length;
}

async function ensureExecutedScheduleRun(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  userId: string;
  scheduleId: string;
  scheduledFor: string;
  executedAt: string;
}) {
  const { data: existingRun, error: existingRunError } = await params.admin
    .from("schedule_runs")
    .select("id")
    .eq("schedule_id", params.scheduleId)
    .eq("scheduled_for", params.scheduledFor)
    .eq("status", "executado")
    .maybeSingle();

  if (existingRunError) {
    throw new Error(existingRunError.message);
  }
  if (existingRun?.id) return;

  const { error: runError } = await params.admin.from("schedule_runs").insert({
    user_id: params.userId,
    schedule_id: params.scheduleId,
    scheduled_for: params.scheduledFor,
    executed_at: params.executedAt,
    status: "executado",
  });
  if (runError) {
    throw new Error(runError.message);
  }
}

async function loadScheduleWithVisualStatus(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  scheduleId: string;
}) {
  const { data: schedule, error } = await params.admin
    .from("schedules")
    .select(
      "id, user_id, debtor_id, charge_id, template_id, template_pending_id, template_overdue_id, data_envio, charge_due_at, status, recurrence, schedule_timezone, recurrence_day, recurrence_time, recurrence_until, first_sent_at, last_sent_at, retry_attempts, payment_received_at, closed_at, debtors(nome, telefone, pix_key, valor, vencimento, accumulate_open_monthly_charges, skip_weekends_on_first_charge, retry_weekdays, retry_time, retry_max_attempts, retry_interval_days, retry_auto_close_days), charge:debtor_charges!schedules_charge_id_fkey(amount, due_day, recurrence_month, recurrence_year), pending_template:message_templates!schedules_template_pending_id_fkey(conteudo), overdue_template:message_templates!schedules_template_overdue_id_fkey(conteudo)",
    )
    .eq("id", params.scheduleId)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (!schedule?.id) return { ok: false as const, error: "Agendamento não encontrado." };

  const { data: latestRun, error: latestRunError } = await params.admin
    .from("schedule_runs")
    .select("scheduled_for, executed_at")
    .eq("schedule_id", params.scheduleId)
    .eq("status", "executado")
    .order("executed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestRunError) {
    return { ok: false as const, error: latestRunError.message };
  }

  const timeZone = String((schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo";
  const lastExecutedScheduledFor = String((latestRun as any)?.scheduled_for ?? "") || null;
  const visualStatus = deriveAgendarVisualStatus(
    {
      ...(schedule as any),
      last_executed_scheduled_for: lastExecutedScheduledFor,
    },
    timeZone as any,
  );

  return {
    ok: true as const,
    schedule,
    timeZone,
    visualStatus,
    lastExecutedScheduledFor,
  };
}

async function applySchedulePaymentSettlement(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  userId: string;
  schedule: any;
}) {
  const recurrence = String((params.schedule as any).recurrence ?? "none");
  const nowIso = new Date().toISOString();
  const scheduledFor = String(
    (params.schedule as any).data_envio ?? (params.schedule as any).charge_due_at ?? nowIso,
  );

  await ensureExecutedScheduleRun({
    admin: params.admin,
    userId: params.userId,
    scheduleId: String((params.schedule as any).id),
    scheduledFor,
    executedAt: nowIso,
  });

  let updatePayload: Record<string, unknown>;
  if (recurrence === "monthly" || recurrence === "yearly") {
    const nextIsoBase = nextRecurringIsoAfterSettlement({
      accumulateOpenMonthlyCharges: Boolean(
        (params.schedule as any).debtors?.accumulate_open_monthly_charges,
      ),
      chargeDueAt: String((params.schedule as any).charge_due_at ?? "") || null,
      dataEnvio: String((params.schedule as any).data_envio ?? "") || null,
      nowUtcIso: nowIso,
      timeZone: String((params.schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo",
      day: Number((params.schedule as any).recurrence_day ?? 1),
      time: String((params.schedule as any).recurrence_time ?? "") || "00:00",
      recurrence,
      targetMonth: Number((params.schedule as any).charge?.recurrence_month ?? 0) || null,
      targetYear: Number((params.schedule as any).charge?.recurrence_year ?? 0) || null,
    });
    const nextIso = shiftFirstChargeFromWeekendUtcIso({
      utcIso: nextIsoBase,
      timeZone: String((params.schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo",
      enabled: Boolean((params.schedule as any).debtors?.skip_weekends_on_first_charge),
    });
    const shouldContinue = shouldContinueRecurringRecurrence({
      nextUtcIso: nextIso,
      recurrenceUntil: String((params.schedule as any).recurrence_until ?? "") || null,
      timeZone: String((params.schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo",
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
          payment_received_at: null,
        }
      : {
          status: "executado",
          payment_received_at: nowIso,
          closed_at: nowIso,
        };
  } else {
    updatePayload = {
      status: "executado",
      payment_received_at: nowIso,
      closed_at: nowIso,
    };
  }

  const { error: updateError } = await params.admin
    .from("schedules")
    .update(updatePayload)
    .eq("id", String((params.schedule as any).id));
  if (updateError) return { ok: false as const, error: updateError.message };

  await syncDebtorChargeStatus(
    params.admin,
    params.userId,
    String((params.schedule as any).debtor_id ?? ""),
  );

  return { ok: true as const };
}

export async function confirmExecutedSchedulePaymentForUser(params: {
  scheduleId: string;
  userId: string;
}) {
  const admin = createSupabaseAdminClient();
  const loaded = await loadScheduleWithVisualStatus({
    admin,
    scheduleId: params.scheduleId,
  });
  if (!loaded.ok) return loaded;
  if (String((loaded.schedule as any).user_id) !== params.userId) {
    return { ok: false as const, error: "Sem permissão." };
  }
  if (loaded.visualStatus.isPaid) {
    return { ok: true as const, alreadyProcessed: true };
  }
  if (loaded.visualStatus.label !== "Executado") {
    return {
      ok: false as const,
      error: "Esse agendamento ainda não possui uma cobrança executada para confirmar pagamento.",
    };
  }

  return applySchedulePaymentSettlement({
    admin,
    userId: params.userId,
    schedule: loaded.schedule,
  });
}

function validateRecurringRecurrenceLimit(params: {
  recurrence: "none" | "monthly" | "yearly";
  currentUtcIso: string;
  timeZone: string;
  recurrenceUntil?: string | null;
}) {
  if (params.recurrence === "none") {
    return { recurrenceUntil: null as string | null, error: null as string | null };
  }

  const maxDate =
    params.recurrence === "yearly"
      ? recurrenceLimitMaxDate({
          recurrence: params.recurrence,
          currentUtcIso: params.currentUtcIso,
          timeZone: params.timeZone,
        })
      : null;
  const effectiveRecurrenceUntil =
    params.recurrence === "yearly" ? params.recurrenceUntil ?? maxDate : params.recurrenceUntil ?? null;
  if (!effectiveRecurrenceUntil) {
    return { recurrenceUntil: null as string | null, error: null as string | null };
  }

  const currentDate = localDateInTimeZone(params.currentUtcIso, params.timeZone);
  if (effectiveRecurrenceUntil < currentDate) {
    return {
      recurrenceUntil: null as string | null,
      error: "A data final da cobrança recorrente deve ser igual ou posterior à cobrança atual.",
    };
  }

  if (params.recurrence === "monthly") {
    const minDate = monthlyRecurrenceLimitMinDate({
      currentUtcIso: params.currentUtcIso,
      timeZone: params.timeZone,
    });

    if (minDate && effectiveRecurrenceUntil < minDate) {
      return {
        recurrenceUntil: null as string | null,
        error: `A data final da cobrança mensal deve ser no mínimo ${formatDateBR(minDate)}, sempre a partir do próximo mês.`,
      };
    }
  }

  if (params.recurrence === "yearly" && maxDate && effectiveRecurrenceUntil > maxDate) {
    return {
      recurrenceUntil: null as string | null,
      error:
        `A recorrência anual permite no máximo ${MAX_YEARLY_RECURRENCE_OCCURRENCES} cobranças. Defina a data final até ${formatDateBR(maxDate)}.`,
    };
  }

  return { recurrenceUntil: effectiveRecurrenceUntil, error: null as string | null };
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
  charge_id: z.string().uuid().optional(),
  template_pending_id: z.string().uuid().optional(),
  template_overdue_id: z.string().uuid().optional(),
  data_envio_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  data_envio_time: z.string().min(4),
  recurrence: z.enum(["none", "monthly", "yearly"]).optional(),
  recurrence_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.string().optional(),
  retry_weekdays: z.array(z.coerce.number().int().min(1).max(7)).optional(),
  retry_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  retry_max_attempts: z.coerce.number().int().min(1).max(5).optional(),
  retry_interval_days: z.coerce.number().int().min(1).max(365).optional(),
  retry_auto_close_days: z.coerce.number().int().min(1).max(365).optional(),
});

const updateSchema = createSchema.extend({
  id: z.string().uuid(),
});

const updateRecurrenceUntilSchema = z.object({
  id: z.string().uuid(),
  recurrence_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

function validateRecurrenceUntil(params: {
  recurrence: "none" | "monthly" | "yearly";
  recurrenceUntil?: string;
  currentDate: string;
}) {
  if (params.recurrence === "none") return null;
  if (!params.recurrenceUntil) return null;
  if (params.recurrenceUntil < params.currentDate) {
    return "A data final da cobrança recorrente deve ser igual ou posterior à primeira cobrança.";
  }
  return null;
}

function validateFutureScheduleDateTime(params: {
  date: string;
  time: string;
  timeZone: string;
}) {
  let scheduledIso: string;
  try {
    scheduledIso = zonedDateTimeToUtcIso({
      date: params.date,
      time: params.time,
      timeZone: params.timeZone,
    });
  } catch {
    return { ok: false as const, error: "Data/hora inválida." };
  }

  const nowRounded = new Date();
  nowRounded.setSeconds(0, 0);
  const minAllowed = nowRounded.getTime() + 3 * 60 * 1000;
  if (new Date(scheduledIso).getTime() < minAllowed) {
    return { ok: false as const, error: "Escolha um horário futuro válido (mínimo +3 minutos)." };
  }

  return { ok: true as const, scheduledIso };
}

type DebtorScheduleChargeRow = {
  id?: string | null;
  due_day?: number | null;
  recurrence_month?: number | null;
  recurrence_year?: number | null;
  created_at?: string | null;
};

function referenceLastDayOfMonth(year: number, month1: number) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function buildReferenceLocalDate(params: {
  day?: number | null;
  month?: number | null;
  year?: number | null;
}) {
  const year = Number(params.year ?? 0);
  const month = Number(params.month ?? 0);
  const day = Number(params.day ?? 0);
  if (!Number.isInteger(year) || year < 2000) return "";
  if (!Number.isInteger(month) || month < 1 || month > 12) return "";
  if (!Number.isInteger(day) || day < 1) return "";
  const safeDay = Math.max(1, Math.min(day, referenceLastDayOfMonth(year, month)));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function compareReferenceChargeOrder(a: DebtorScheduleChargeRow, b: DebtorScheduleChargeRow) {
  const yearA = Number(a.recurrence_year ?? 0);
  const yearB = Number(b.recurrence_year ?? 0);
  if (yearA !== yearB) return yearA - yearB;
  const monthA = Number(a.recurrence_month ?? 0);
  const monthB = Number(b.recurrence_month ?? 0);
  if (monthA !== monthB) return monthA - monthB;
  const dayA = Number(a.due_day ?? 0);
  const dayB = Number(b.due_day ?? 0);
  if (dayA !== dayB) return dayA - dayB;
  return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
}

async function resolveScheduleLocalDate(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  debtorId: string;
  chargeId?: string | null;
  providedDate?: string | null;
}) {
  const providedDate = String(params.providedDate ?? "").trim();
  const providedChargeId = String(params.chargeId ?? "").trim();

  const { data, error } = await params.supabase
    .from("debtors")
    .select("vencimento, debtor_charges(id, due_day, recurrence_month, recurrence_year, created_at)")
    .eq("id", params.debtorId)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };

  const charges = (Array.isArray((data as any)?.debtor_charges) ? (data as any).debtor_charges : [])
    .filter((charge: DebtorScheduleChargeRow) => {
      const year = Number(charge.recurrence_year ?? 0);
      const month = Number(charge.recurrence_month ?? 0);
      const day = Number(charge.due_day ?? 0);
      return year >= 2000 && month >= 1 && month <= 12 && day >= 1;
    })
    .sort(compareReferenceChargeOrder);

  const matchedCharge =
    charges.find((charge: DebtorScheduleChargeRow) => String(charge.id ?? "").trim() === providedChargeId) ??
    null;
  const resolvedCharge = matchedCharge ?? ((charges[0] as DebtorScheduleChargeRow | undefined) ?? null);
  const chargeLocalDate = resolvedCharge
    ? buildReferenceLocalDate({
        day: resolvedCharge.due_day,
        month: resolvedCharge.recurrence_month,
        year: resolvedCharge.recurrence_year,
      })
    : "";
  if (chargeLocalDate) {
    return {
      ok: true as const,
      localDate: chargeLocalDate,
      chargeId: String(resolvedCharge?.id ?? "").trim() || null,
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(providedDate)) {
    return { ok: true as const, localDate: providedDate, chargeId: null };
  }

  const legacyDueDate = String((data as any)?.vencimento ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(legacyDueDate)) {
    return { ok: true as const, localDate: legacyDueDate, chargeId: null };
  }

  return {
    ok: false as const,
    error: "Esse cliente não possui data cadastrada para o agendamento.",
  };
}

async function ensureScheduleLocalDateAvailable(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  debtorId: string;
  localDate: string;
  chargeId?: string | null;
  defaultTimeZone: string;
  excludeId?: string;
}) {
  let query = params.supabase
    .from("schedules")
    .select("id, charge_id, charge_due_at, data_envio, schedule_timezone, closed_at")
    .eq("debtor_id", params.debtorId)
    .is("closed_at", null)
    .limit(200);

  if (params.excludeId) {
    query = query.neq("id", params.excludeId);
  }

  const { data, error } = await query;
  if (error) return { ok: false as const, error: error.message };
  const incomingChargeId = String(params.chargeId ?? "").trim();

  const conflict = (data ?? []).some((row: any) => {
    const referenceMoment = String(row?.charge_due_at ?? row?.data_envio ?? "").trim();
    if (!referenceMoment) return false;
    const rowChargeId = String(row?.charge_id ?? "").trim();
    const rowTimeZone = String(row?.schedule_timezone ?? "").trim() || params.defaultTimeZone;
    let sameLocalDate = false;
    try {
      sameLocalDate = localDateInTimeZone(referenceMoment, rowTimeZone) === params.localDate;
    } catch {
      sameLocalDate = referenceMoment.slice(0, 10) === params.localDate;
    }
    if (!sameLocalDate) return false;
    if (!incomingChargeId || !rowChargeId) return true;
    return rowChargeId === incomingChargeId;
  });

  if (conflict) {
    return {
      ok: false as const,
      error: "Essa data do cliente já está em uso em outro agendamento.",
    };
  }

  return { ok: true as const };
}

async function updateDebtorRetrySettings(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  debtorId: string,
  input: {
    retry_weekdays?: number[];
    retry_time?: string;
    retry_max_attempts?: number;
    retry_interval_days?: number;
    retry_auto_close_days?: number;
  },
) {
  const { error } = await supabase
    .from("debtors")
    .update({
      retry_weekdays: normalizeRetryWeekdays(input.retry_weekdays),
      retry_time: input.retry_time || DEFAULT_RETRY_TIME,
      retry_max_attempts: Math.min(5, input.retry_max_attempts || DEFAULT_RETRY_MAX_ATTEMPTS),
      retry_interval_days: input.retry_interval_days || DEFAULT_RETRY_INTERVAL_DAYS,
      retry_auto_close_days: input.retry_auto_close_days || DEFAULT_RETRY_AUTO_CLOSE_DAYS,
    })
    .eq("id", debtorId);
  return error;
}

async function countOpenMonthlySchedulesForDebtor(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  debtorId: string;
  excludeId?: string;
}) {
  let query = params.supabase
    .from("schedules")
    .select("id", { count: "exact", head: true })
    .eq("debtor_id", params.debtorId)
    .eq("recurrence", "monthly")
    .is("closed_at", null);

  if (params.excludeId) {
    query = query.neq("id", params.excludeId);
  }

  const { count, error } = await query;
  if (error) return { ok: false as const, error: error.message, count: 0 };
  return { ok: true as const, count: count ?? 0 };
}

export async function createScheduleAction(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  const recurrence = parsed.data.recurrence ?? "none";

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
  if (recurrence === "monthly") {
    const monthlyCountCheck = await countOpenMonthlySchedulesForDebtor({
      supabase,
      debtorId: parsed.data.debtor_id,
    });
    if (!monthlyCountCheck.ok) return { ok: false, error: monthlyCountCheck.error };
    if (monthlyCountCheck.count >= MAX_MONTHLY_SCHEDULES_PER_DEBTOR) {
      return {
        ok: false,
        error: `Esse cliente pode ter no máximo ${MAX_MONTHLY_SCHEDULES_PER_DEBTOR} cobranças mensais no bloco "Cobranças no mês".`,
      };
    }
  }

  const scheduleLocalDateResult = await resolveScheduleLocalDate({
    supabase,
    debtorId: parsed.data.debtor_id,
    chargeId: parsed.data.charge_id,
    providedDate: parsed.data.data_envio_date,
  });
  if (!scheduleLocalDateResult.ok) return { ok: false, error: scheduleLocalDateResult.error };
  const scheduleLocalDate = scheduleLocalDateResult.localDate;
  const dateAvailability = await ensureScheduleLocalDateAvailable({
    supabase,
    debtorId: parsed.data.debtor_id,
    localDate: scheduleLocalDate,
    chargeId: scheduleLocalDateResult.chargeId,
    defaultTimeZone: timeZone,
  });
  if (!dateAvailability.ok) return { ok: false, error: dateAvailability.error };

  const futureValidation = validateFutureScheduleDateTime({
    date: scheduleLocalDate,
    time: parsed.data.data_envio_time,
    timeZone,
  });
  if (!futureValidation.ok) return { ok: false, error: futureValidation.error };
  let dataEnvioIso = futureValidation.scheduledIso;

  dataEnvioIso = shiftFirstChargeFromWeekendUtcIso({
    utcIso: dataEnvioIso,
    timeZone,
    enabled: await debtorSkipsWeekendsOnFirstCharge(supabase, parsed.data.debtor_id),
  });

  const recurrenceValidation = validateRecurrenceUntil({
    recurrence,
    recurrenceUntil: parsed.data.recurrence_until,
    currentDate: scheduleLocalDate,
  });
  if (recurrenceValidation) return { ok: false, error: recurrenceValidation };
  const recurrenceDay = Number(scheduleLocalDate.split("-")[2] ?? "");
  const recurrenceTime = parsed.data.data_envio_time;
  const recurrenceLimitValidation = validateRecurringRecurrenceLimit({
    recurrence,
    currentUtcIso: dataEnvioIso,
    timeZone,
    recurrenceUntil: parsed.data.recurrence_until ?? null,
  });
  if (recurrenceLimitValidation.error) return { ok: false, error: recurrenceLimitValidation.error };
  const recurrenceUntil = recurrenceLimitValidation.recurrenceUntil;

  const retryUpdateError = await updateDebtorRetrySettings(supabase, parsed.data.debtor_id, parsed.data);
  if (retryUpdateError) return { ok: false, error: retryUpdateError.message };

  const { error } = await supabase.from("schedules").insert({
    debtor_id: parsed.data.debtor_id,
    charge_id: scheduleLocalDateResult.chargeId,
    template_id: parsed.data.template_pending_id ?? null,
    template_pending_id: parsed.data.template_pending_id ?? null,
    template_overdue_id: parsed.data.template_overdue_id ?? null,
    data_envio: dataEnvioIso,
    charge_due_at: dataEnvioIso,
    recurrence,
    schedule_timezone: recurrence !== "none" ? timeZone : null,
    recurrence_day: recurrence !== "none" ? (Number.isFinite(recurrenceDay) ? recurrenceDay : null) : null,
    recurrence_time: recurrence !== "none" ? recurrenceTime : null,
    recurrence_until: recurrence !== "none" ? recurrenceUntil : null,
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
  const recurrence = (data as any).recurrence ?? "none";
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
  const admin = createSupabaseAdminClient();
  const loaded = await loadScheduleWithVisualStatus({ admin, scheduleId: id });
  if (!loaded.ok) return loaded;
  if (String((loaded.schedule as any).user_id) !== userId) {
    return { ok: false, error: "Sem permissão." };
  }
  if (loaded.visualStatus.label === "Executado") {
    return { ok: false, error: "Agendamentos executados não podem ser editados." };
  }
  if (recurrence === "monthly") {
    const monthlyCountCheck = await countOpenMonthlySchedulesForDebtor({
      supabase,
      debtorId: data.debtor_id,
      excludeId: id,
    });
    if (!monthlyCountCheck.ok) return { ok: false, error: monthlyCountCheck.error };
    if (monthlyCountCheck.count >= MAX_MONTHLY_SCHEDULES_PER_DEBTOR) {
      return {
        ok: false,
        error: `Esse cliente pode ter no máximo ${MAX_MONTHLY_SCHEDULES_PER_DEBTOR} cobranças mensais no bloco "Cobranças no mês".`,
      };
    }
  }

  const scheduleLocalDateResult = await resolveScheduleLocalDate({
    supabase,
    debtorId: data.debtor_id,
    chargeId: data.charge_id,
    providedDate: data.data_envio_date,
  });
  if (!scheduleLocalDateResult.ok) return { ok: false, error: scheduleLocalDateResult.error };
  const scheduleLocalDate = scheduleLocalDateResult.localDate;
  const dateAvailability = await ensureScheduleLocalDateAvailable({
    supabase,
    debtorId: data.debtor_id,
    localDate: scheduleLocalDate,
    chargeId: scheduleLocalDateResult.chargeId,
    defaultTimeZone: timeZone,
    excludeId: id,
  });
  if (!dateAvailability.ok) return { ok: false, error: dateAvailability.error };

  const futureValidation = validateFutureScheduleDateTime({
    date: scheduleLocalDate,
    time: data.data_envio_time,
    timeZone,
  });
  if (!futureValidation.ok) return { ok: false, error: futureValidation.error };
  let dataEnvioIso = futureValidation.scheduledIso;

  dataEnvioIso = shiftFirstChargeFromWeekendUtcIso({
    utcIso: dataEnvioIso,
    timeZone,
    enabled: await debtorSkipsWeekendsOnFirstCharge(supabase, data.debtor_id),
  });

  const recurrenceValidation = validateRecurrenceUntil({
    recurrence,
    recurrenceUntil: data.recurrence_until,
    currentDate: scheduleLocalDate,
  });
  if (recurrenceValidation) return { ok: false, error: recurrenceValidation };
  const recurrenceDay = Number(scheduleLocalDate.split("-")[2] ?? "");
  const recurrenceTime = String(data.data_envio_time ?? "");
  const recurrenceLimitValidation = validateRecurringRecurrenceLimit({
    recurrence,
    currentUtcIso: dataEnvioIso,
    timeZone,
    recurrenceUntil: data.recurrence_until ?? null,
  });
  if (recurrenceLimitValidation.error) return { ok: false, error: recurrenceLimitValidation.error };
  const recurrenceUntil = recurrenceLimitValidation.recurrenceUntil;

  const retryUpdateError = await updateDebtorRetrySettings(supabase, data.debtor_id, data);
  if (retryUpdateError) return { ok: false, error: retryUpdateError.message };

  const { error } = await supabase
    .from("schedules")
    .update({
      debtor_id: data.debtor_id,
      charge_id: scheduleLocalDateResult.chargeId,
      template_id: data.template_pending_id ?? null,
      template_pending_id: data.template_pending_id ?? null,
      template_overdue_id: data.template_overdue_id ?? null,
      data_envio: dataEnvioIso,
      charge_due_at: dataEnvioIso,
      recurrence,
      schedule_timezone: recurrence !== "none" ? timeZone : null,
      recurrence_day: recurrence !== "none" ? (Number.isFinite(recurrenceDay) ? recurrenceDay : null) : null,
      recurrence_time: recurrence !== "none" ? recurrenceTime : null,
      recurrence_until: recurrence !== "none" ? recurrenceUntil : null,
      status: data.status ?? "agendado",
      first_sent_at: null,
      last_sent_at: null,
      retry_attempts: 0,
      payment_received_at: null,
      closed_at: null,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  await syncDebtorChargeStatus(admin, userId, data.debtor_id);
  const previousDebtorId = String((loaded.schedule as any)?.debtor_id ?? "");
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
  const recurrence = String((schedule as any).recurrence ?? "none") as "none" | "monthly" | "yearly";
  if (recurrence !== "monthly" && recurrence !== "yearly") {
    return { ok: false, error: "Essa opção está disponível apenas para agendamentos recorrentes." };
  }

  const recurrenceLimitValidation = validateRecurringRecurrenceLimit({
    recurrence,
    currentUtcIso: String((schedule as any).data_envio),
    timeZone: String((schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo",
    recurrenceUntil: parsed.data.recurrence_until ?? null,
  });
  if (recurrenceLimitValidation.error) {
    return { ok: false, error: recurrenceLimitValidation.error };
  }

  const { error: updateError } = await admin
    .from("schedules")
    .update({ recurrence_until: recurrenceLimitValidation.recurrenceUntil })
    .eq("id", parsed.data.id);
  if (updateError) return { ok: false, error: updateError.message };

  await admin.from("logs").insert({
    user_id: userId,
    tipo: "agenda_recorrencia_final",
    descricao: recurrenceLimitValidation.recurrenceUntil
      ? `Data final da cobrança recorrente definida para ${recurrenceLimitValidation.recurrenceUntil} no agendamento ${parsed.data.id}`
      : `Data final da cobrança recorrente removida do agendamento ${parsed.data.id}`,
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
  const loaded = await loadScheduleWithVisualStatus({ admin, scheduleId: id });
  if (!loaded.ok) return loaded;
  const schedule = loaded.schedule;
  if (String((schedule as any).user_id) !== userId) return { ok: false, error: "Sem permissão." };
  if (loaded.visualStatus.label === "Executado") {
    return { ok: false, error: "Esse agendamento não pode ser reenviado manualmente agora." };
  }

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
    const timeZone = String((schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo";
    const retryConfig = normalizeRetryConfig(debtor ?? {});

    const debtorPhone = String(debtor?.telefone ?? "");
    const chargeAmount = getScheduleChargeAmount({
      baseAmount: (schedule as any).charge?.amount ?? debtor?.valor,
      accumulateOpenMonthlyCharges: Boolean(debtor?.accumulate_open_monthly_charges),
      recurrence: String((schedule as any).recurrence ?? ""),
      status: currentStatus,
      closedAt: String((schedule as any).closed_at ?? "") || null,
      chargeDueAt: String((schedule as any).charge_due_at ?? "") || null,
      dataEnvio: String((schedule as any).data_envio ?? "") || null,
      nowUtcIso: new Date().toISOString(),
      timeZone: String((schedule as any).schedule_timezone ?? "") || "America/Sao_Paulo",
    });
    const templateText = String(
      sourceStatus === "atrasado" ? overdueTemplate?.conteudo ?? "" : pendingTemplate?.conteudo ?? "",
    );
    if (!debtorPhone) throw new Error("Cliente sem telefone");
    if (!templateText.trim()) {
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
      valor: formatBRL(chargeAmount ?? (schedule as any).charge?.amount ?? debtor?.valor),
      vencimento: formatDateBR(
        localDateInTimeZone(
          String((schedule as any).charge_due_at ?? (schedule as any).data_envio ?? new Date().toISOString()),
          timeZone,
        ),
      ),
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

    const nowIso = new Date().toISOString();
    const nowLocalDate = localDateInTimeZone(nowIso, timeZone);
    const sentToday =
      sourceStatus === "atrasado"
        ? await countExecutedRunsOnLocalDate({
            admin,
            scheduleId,
            timeZone,
            localDate: nowLocalDate,
          })
        : 0;
    const nextSameDayRetryAt =
      sourceStatus === "atrasado"
        ? nextSameDayRetryUtcIso({
            nowUtcIso: nowIso,
            localDate: nowLocalDate,
            timeZone,
            time: retryConfig.time,
            dailySendLimit: retryConfig.maxAttempts,
            sentToday,
          })
        : null;

    const { error: updateError } = await admin
      .from("schedules")
      .update({
        status: nextSameDayRetryAt ? "atrasado" : "pendente",
        first_sent_at: String((schedule as any).first_sent_at ?? "") || nowIso,
        last_sent_at: nowIso,
        retry_attempts: Number((schedule as any).retry_attempts ?? 0) + 1,
        ...(nextSameDayRetryAt ? { data_envio: nextSameDayRetryAt } : {}),
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
    if ((recurrence === "monthly" || recurrence === "yearly") && !wasExecuted.data?.id) {
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
  const loaded = await loadScheduleWithVisualStatus({ admin, scheduleId: id });
  if (!loaded.ok) return loaded;
  const schedule = loaded.schedule;
  if (String((schedule as any).user_id) !== userId) return { ok: false, error: "Sem permissão." };
  const currentStatus = String((schedule as any).status ?? "");
  if (currentStatus === "executando") {
    return { ok: false, error: "Esse agendamento está sendo processado no momento." };
  }
  if (loaded.visualStatus.isPaid) {
    return { ok: false, error: "Esse agendamento já foi marcado como pago." };
  }
  if (!["Agendado", "Executado"].includes(loaded.visualStatus.label)) {
    return {
      ok: false,
      error: "Esse agendamento não pode ser marcado manualmente como pago nesse status.",
    };
  }

  const settlement = await applySchedulePaymentSettlement({
    admin,
    userId,
    schedule,
  });
  if (!settlement.ok) return settlement;

  await admin.from("logs").insert({
    user_id: userId,
    tipo: "agenda_pagamento_manual",
    descricao: `Pagamento marcado manualmente como realizado para o agendamento ${String((schedule as any).id)}`,
  });

  return { ok: true };
}
