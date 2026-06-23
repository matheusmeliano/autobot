"use server";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizePlan } from "@/lib/plans";
import {
  DEFAULT_RETRY_AUTO_CLOSE_DAYS,
  DEFAULT_RETRY_INTERVAL_DAYS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  MAX_RETRY_ATTEMPTS_PER_DAY,
  DEFAULT_RETRY_TIME,
  nextRetryUtcIso,
  normalizeRetryWeekdays,
} from "@/lib/chargeRetry";
import { syncDebtorChargeStatus } from "@/lib/debtorChargeStatus";
import { localDateInTimeZone } from "@/lib/recurrence";
import { BRAZIL_TIMEZONES, zonedDateTimeToUtcIso } from "@/lib/timezone";

const createSchema = z
  .object({
    nome: z.string().min(2),
    telefone: z.string().optional(),
    valor: z.coerce.number().optional(),
    vencimento: z.string().optional(),
    charges: z
      .array(
        z.object({
          id: z.string().uuid().optional(),
          amount: z.coerce.number().min(0.01),
          due_day: z.coerce.number().int().min(1).max(31),
          recurrence_month: z.coerce.number().int().min(1).max(12),
          recurrence_year: z.coerce.number().int().min(2000).max(9999),
        }),
      )
      .min(1)
      .max(5)
      .optional(),
    pix_key: z.string().optional(),
    observacoes: z.string().optional(),
    status: z.string().optional(),
    accumulate_open_monthly_charges: z.boolean().optional(),
    skip_weekends_on_first_charge: z.boolean().optional(),
    retry_weekdays: z.array(z.coerce.number().int().min(1).max(7)).optional(),
    retry_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    retry_max_attempts: z.coerce.number().int().min(1).max(MAX_RETRY_ATTEMPTS_PER_DAY).optional(),
    retry_interval_days: z.coerce.number().int().min(1).max(365).optional(),
    retry_auto_close_days: z.coerce.number().int().min(1).max(365).optional(),
  })
  .superRefine((data, ctx) => {
    const hasCharges = Array.isArray(data.charges) && data.charges.length > 0;
    if (!hasCharges) {
      const hasLegacy = typeof data.valor === "number" && /^\d{4}-\d{2}-\d{2}$/.test(String(data.vencimento ?? ""));
      if (!hasLegacy) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe pelo menos 1 cobrança (valor e dia de vencimento).",
          path: ["charges"],
        });
      }
      return;
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    for (const [index, charge] of (data.charges ?? []).entries()) {
      const targetKey = charge.recurrence_year * 100 + charge.recurrence_month;
      const currentKey = currentYear * 100 + currentMonth;
      if (targetKey < currentKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Mês e ano da recorrência devem ser do mês atual em diante.",
          path: ["charges", index, "recurrence_month"],
        });
      }
    }
  });

const updateSchema = createSchema.extend({
  id: z.string().uuid(),
});

type TemplateChoice = {
  id: string;
  nome?: string | null;
  created_at?: string | null;
};

type DebtorChargeInput = {
  id?: string;
  amount: number;
  due_day: number;
  recurrence_month: number;
  recurrence_year: number;
};

function compareDebtorChargeOrder(
  a: Pick<DebtorChargeInput, "due_day" | "recurrence_month" | "recurrence_year">,
  b: Pick<DebtorChargeInput, "due_day" | "recurrence_month" | "recurrence_year">,
) {
  if (a.recurrence_year !== b.recurrence_year) return a.recurrence_year - b.recurrence_year;
  if (a.recurrence_month !== b.recurrence_month) return a.recurrence_month - b.recurrence_month;
  return a.due_day - b.due_day;
}

function validTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

function weekdayFromLocalDate(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const weekday = base.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function localDateTimeParts(utcIso: string, timeZone: string) {
  const base = new Date(utcIso);
  if (Number.isNaN(base.getTime())) throw new Error("Data inválida");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(base);
  return parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
}

function resolveChargeTemplateIds(templates: TemplateChoice[]) {
  if (!templates.length) return { pendingId: null, overdueId: null };

  const sorted = [...templates].sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );
  const findByName = (keywords: string[], excludeIds = new Set<string>()) =>
    sorted.find((template) => {
      const id = String(template.id ?? "");
      if (!id || excludeIds.has(id)) return false;
      const name = String(template.nome ?? "").trim().toLowerCase();
      return keywords.some((keyword) => name.includes(keyword));
    });

  const pending =
    findByName(["pendente", "inicial", "primeira"]) ??
    sorted[0] ??
    null;
  const overdue =
    findByName(["atras", "vencid", "overdue"], new Set([String(pending?.id ?? "")])) ??
    sorted.find((template) => String(template.id ?? "") !== String(pending?.id ?? "")) ??
    pending;

  return {
    pendingId: pending?.id ? String(pending.id) : null,
    overdueId: overdue?.id ? String(overdue.id) : pending?.id ? String(pending.id) : null,
  };
}

function nextInitialOverdueAttemptUtcIso(params: {
  nowUtcIso: string;
  timeZone: string;
  retryWeekdays?: number[];
  retryTime?: string;
  retryIntervalDays?: number;
}) {
  const retryWeekdays = normalizeRetryWeekdays(params.retryWeekdays);
  const retryTime = validTime(String(params.retryTime ?? "")) ? String(params.retryTime) : DEFAULT_RETRY_TIME;
  const retryIntervalDays = Math.min(
    365,
    Math.max(1, Number(params.retryIntervalDays) || DEFAULT_RETRY_INTERVAL_DAYS),
  );
  const parts = localDateTimeParts(params.nowUtcIso, params.timeZone);
  const currentLocalDate = `${parts.year}-${parts.month}-${parts.day}`;
  const currentLocalTime = `${parts.hour ?? "00"}:${parts.minute ?? "00"}`;
  const todayAllowed = retryWeekdays.includes(weekdayFromLocalDate(currentLocalDate));

  if (todayAllowed && currentLocalTime <= retryTime) {
    return zonedDateTimeToUtcIso({
      date: currentLocalDate,
      time: retryTime,
      timeZone: params.timeZone,
    });
  }

  return nextRetryUtcIso({
    fromUtcIso: params.nowUtcIso,
    timeZone: params.timeZone,
    weekdays: retryWeekdays,
    time: retryTime,
    intervalDays: retryIntervalDays,
  });
}

function diffDaysLocalDate(fromDate: string, toDate: string) {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd, 12, 0, 0);
  const to = Date.UTC(ty, tm - 1, td, 12, 0, 0);
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

function lastDayOfMonth(year: number, month1: number) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function buildLocalDate(yearMonth: string, day: number) {
  const [yearRaw, monthRaw] = yearMonth.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) return "";
  const safeDay = Math.max(1, Math.min(Number(day) || 1, lastDayOfMonth(year, month)));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function nextMonthYear(baseDate = new Date()) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + 1;
  const monthIndex = month;
  const nextYear = year + Math.floor(monthIndex / 12);
  const nextMonth = (monthIndex % 12) + 1;
  return { month: nextMonth, year: nextYear };
}

function normalizeDebtorCharges(input: {
  charges?:
    | Array<{
        id?: string;
        amount: number;
        due_day: number;
        recurrence_month?: number;
        recurrence_year?: number;
      }>
    | null;
  valor?: number;
  vencimento?: string;
}): DebtorChargeInput[] {
  const fallbackRecurrence = nextMonthYear();
  const fromList = Array.isArray(input.charges) ? input.charges : [];
  if (fromList.length) {
    const normalized: DebtorChargeInput[] = fromList
      .map((c) => ({
        id: c.id ? String(c.id) : undefined,
        amount: Number(c.amount),
        due_day: Number(c.due_day),
        recurrence_month: Number(c.recurrence_month ?? fallbackRecurrence.month),
        recurrence_year: Number(c.recurrence_year ?? fallbackRecurrence.year),
      }))
      .filter(
        (c) =>
          Number.isFinite(c.amount) &&
          c.amount > 0 &&
          Number.isInteger(c.due_day) &&
          c.due_day >= 1 &&
          c.due_day <= 31 &&
          Number.isInteger(c.recurrence_month) &&
          c.recurrence_month >= 1 &&
          c.recurrence_month <= 12 &&
          Number.isInteger(c.recurrence_year) &&
          c.recurrence_year >= 2000 &&
          c.recurrence_year <= 9999,
      )
      .slice(0, 5)
      .sort(compareDebtorChargeOrder);
    if (normalized.length) return normalized;
  }

  const legacyAmount = Number(input.valor);
  const legacyDue = String(input.vencimento ?? "").trim();
  if (Number.isFinite(legacyAmount) && legacyAmount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(legacyDue)) {
    return [
      {
        amount: legacyAmount,
        due_day: Number(legacyDue.slice(8, 10)),
        recurrence_month: fallbackRecurrence.month,
        recurrence_year: fallbackRecurrence.year,
      },
    ];
  }

  return [];
}

async function syncDebtorChargesAndSchedules(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  debtorId: string;
  charges: DebtorChargeInput[];
  retryWeekdays?: number[];
  retryTime?: string;
  retryIntervalDays?: number;
  nowUtcIso?: string;
  timeZone?: string | null;
}) {
  const nowUtcIso = params.nowUtcIso ?? new Date().toISOString();
  const timeZone =
    params.timeZone && BRAZIL_TIMEZONES.includes(params.timeZone as (typeof BRAZIL_TIMEZONES)[number])
      ? params.timeZone
      : "America/Sao_Paulo";
  const currentLocalDate = localDateInTimeZone(nowUtcIso, timeZone);
  const retryTime = validTime(String(params.retryTime ?? "")) ? String(params.retryTime) : DEFAULT_RETRY_TIME;

  const { data: templates, error: templatesError } = await params.supabase
    .from("message_templates")
    .select("id, nome, created_at")
    .order("created_at", { ascending: true })
    .limit(50);
  if (templatesError) return { ok: false as const, error: templatesError.message };
  const templateIds = resolveChargeTemplateIds((templates ?? []) as TemplateChoice[]);
  if (!templateIds.pendingId || !templateIds.overdueId) {
    const { error: closeError } = await params.supabase
      .from("schedules")
      .update({ closed_at: nowUtcIso })
      .eq("debtor_id", params.debtorId)
      .is("closed_at", null)
      .in("recurrence", ["monthly", "yearly"]);
    if (closeError) return { ok: false as const, error: closeError.message };
    await syncDebtorChargeStatus(createSupabaseAdminClient(), params.userId, params.debtorId);
    return {
      ok: true as const,
      warning:
        "Cliente salvo, mas sem template suficiente para gerar cobranças automáticas. Configure seus templates em Mensagens.",
    };
  }

  const { data: existingCharges, error: existingChargesError } = await params.supabase
    .from("debtor_charges")
    .select("id")
    .eq("debtor_id", params.debtorId)
    .limit(20);
  if (existingChargesError) return { ok: false as const, error: existingChargesError.message };
  const existingChargeIds = new Set((existingCharges ?? []).map((c: any) => String(c?.id ?? "")).filter(Boolean));

  const incomingWithId = params.charges.filter((c) => c.id && existingChargeIds.has(String(c.id)));
  for (const charge of incomingWithId) {
    const { error } = await params.supabase
      .from("debtor_charges")
      .update({
        amount: charge.amount,
        due_day: charge.due_day,
        recurrence_month: charge.recurrence_month,
        recurrence_year: charge.recurrence_year,
      })
      .eq("id", String(charge.id));
    if (error) return { ok: false as const, error: error.message };
  }

  const toInsert = params.charges.filter((c) => !c.id || !existingChargeIds.has(String(c.id)));
  let inserted: Array<{ id: string; amount: number; due_day: number }> = [];
  if (toInsert.length) {
    const { data, error } = await params.supabase
      .from("debtor_charges")
      .insert(
        toInsert.map((c) => ({
          debtor_id: params.debtorId,
          amount: c.amount,
          due_day: c.due_day,
          recurrence_month: c.recurrence_month,
          recurrence_year: c.recurrence_year,
        })),
      )
      .select("id, amount, due_day, recurrence_month, recurrence_year");
    if (error) return { ok: false as const, error: error.message };
    inserted = (data ?? []) as any[];
  }

  const currentChargeIds = new Set(
    params.charges
      .map((c) => (c.id && existingChargeIds.has(String(c.id)) ? String(c.id) : null))
      .filter(Boolean),
  );
  for (const c of inserted) currentChargeIds.add(String((c as any).id ?? ""));

  const removedIds = Array.from(existingChargeIds).filter((id) => !currentChargeIds.has(id));
  if (removedIds.length) {
    const { error: closeError } = await params.supabase
      .from("schedules")
      .update({ closed_at: nowUtcIso, status: "pago", charge_id: null })
      .in("charge_id", removedIds)
      .is("closed_at", null);
    if (closeError) return { ok: false as const, error: closeError.message };

    const { error: deleteChargesError } = await params.supabase.from("debtor_charges").delete().in("id", removedIds);
    if (deleteChargesError) return { ok: false as const, error: deleteChargesError.message };
  }

  const { data: finalCharges, error: finalChargesError } = await params.supabase
    .from("debtor_charges")
    .select("id, amount, due_day, recurrence_month, recurrence_year, created_at")
    .eq("debtor_id", params.debtorId)
    .order("recurrence_year", { ascending: true })
    .order("recurrence_month", { ascending: true })
    .order("due_day", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(10);
  if (finalChargesError) return { ok: false as const, error: finalChargesError.message };

  for (const charge of finalCharges ?? []) {
    const chargeId = String((charge as any).id ?? "");
    const dueDay = Number((charge as any).due_day ?? 1);
    const targetYear = Number((charge as any).recurrence_year ?? 0);
    const targetMonth = Number((charge as any).recurrence_month ?? 0);
    const targetYearMonth =
      Number.isInteger(targetYear) &&
      targetYear >= 2000 &&
      Number.isInteger(targetMonth) &&
      targetMonth >= 1 &&
      targetMonth <= 12
        ? `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}`
        : currentLocalDate.slice(0, 7);
    const dueLocalDate = buildLocalDate(targetYearMonth, dueDay);
    if (!dueLocalDate) continue;

    const dueAt = zonedDateTimeToUtcIso({ date: dueLocalDate, time: retryTime, timeZone });
    const daysSinceDue = diffDaysLocalDate(dueLocalDate, currentLocalDate);
    const shouldStartOverdue = daysSinceDue >= 3;
    const shouldSendNow = daysSinceDue >= 0 && !shouldStartOverdue;
    const scheduleAt =
      shouldStartOverdue || shouldSendNow
        ? nextInitialOverdueAttemptUtcIso({
            nowUtcIso,
            timeZone,
            retryWeekdays: params.retryWeekdays,
            retryTime,
            retryIntervalDays: params.retryIntervalDays,
          })
        : dueAt;

    const status = shouldStartOverdue ? "atrasado" : "agendado";

    const { data: existingSchedule, error: scheduleLookupError } = await params.supabase
      .from("schedules")
      .select("id, status, first_sent_at")
      .eq("charge_id", chargeId)
      .is("closed_at", null)
      .limit(1)
      .maybeSingle();
    if (scheduleLookupError) return { ok: false as const, error: scheduleLookupError.message };

    if (!existingSchedule?.id) {
      const { error: insertScheduleError } = await params.supabase.from("schedules").insert({
        debtor_id: params.debtorId,
        charge_id: chargeId,
        template_id: templateIds.pendingId,
        template_pending_id: templateIds.pendingId,
        template_overdue_id: templateIds.overdueId,
        data_envio: scheduleAt,
        charge_due_at: dueAt,
        recurrence: "monthly",
        schedule_timezone: timeZone,
        recurrence_day: Number.isFinite(dueDay) ? dueDay : 1,
        recurrence_time: retryTime,
        recurrence_until: null,
        status,
      });
      if (insertScheduleError) return { ok: false as const, error: insertScheduleError.message };
    } else {
      const existingStatus = String((existingSchedule as any)?.status ?? "");
      const hasFirstSent = Boolean(String((existingSchedule as any)?.first_sent_at ?? "").trim());
      const updateBase: Record<string, unknown> = {
        template_id: templateIds.pendingId,
        template_pending_id: templateIds.pendingId,
        template_overdue_id: templateIds.overdueId,
        recurrence: "monthly",
        schedule_timezone: timeZone,
        recurrence_day: Number.isFinite(dueDay) ? dueDay : 1,
        recurrence_time: retryTime,
      };
      const updatePayload =
        existingStatus === "agendado" && !hasFirstSent
          ? { ...updateBase, data_envio: scheduleAt, charge_due_at: dueAt, status }
          : updateBase;
      const { error: updateScheduleError } = await params.supabase
        .from("schedules")
        .update(updatePayload)
        .eq("id", String((existingSchedule as any).id));
      if (updateScheduleError) return { ok: false as const, error: updateScheduleError.message };
    }
  }

  await syncDebtorChargeStatus(createSupabaseAdminClient(), params.userId, params.debtorId);
  return { ok: true as const };
}

export async function createDebtorAction(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const charges = normalizeDebtorCharges(parsed.data);
  if (!charges.length) {
    return { ok: false, error: "Informe pelo menos 1 cobrança (valor e dia de vencimento)." };
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: userRes }, { data: profile }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("plano, timezone").maybeSingle(),
  ]);
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };
  const plan = normalizePlan((profile as any)?.plano);
  const limited = plan !== "pro" && plan !== "vitalicio";

  if (limited) {
    const { count } = await supabase
      .from("debtors")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) >= 15) {
      return {
        ok: false,
        error: "Limite do plano básico: até 15 cadastros de clientes.",
      };
    }
  }

  const totalAmount = charges.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
  const debtorPayload = {
    nome: parsed.data.nome,
    telefone: parsed.data.telefone || null,
    valor: Number.isFinite(totalAmount) && totalAmount > 0 ? totalAmount : null,
    vencimento: null,
    pix_key: parsed.data.pix_key || null,
    observacoes: parsed.data.observacoes || null,
    status: parsed.data.status || "ativo",
    accumulate_open_monthly_charges: Boolean(parsed.data.accumulate_open_monthly_charges),
    skip_weekends_on_first_charge: Boolean(parsed.data.skip_weekends_on_first_charge),
    retry_weekdays: normalizeRetryWeekdays(parsed.data.retry_weekdays),
    retry_time: parsed.data.retry_time || DEFAULT_RETRY_TIME,
    retry_max_attempts: Math.min(
      MAX_RETRY_ATTEMPTS_PER_DAY,
      parsed.data.retry_max_attempts || DEFAULT_RETRY_MAX_ATTEMPTS,
    ),
    retry_interval_days: parsed.data.retry_interval_days || DEFAULT_RETRY_INTERVAL_DAYS,
    retry_auto_close_days: parsed.data.retry_auto_close_days || DEFAULT_RETRY_AUTO_CLOSE_DAYS,
  };

  const { data: createdDebtor, error } = await supabase
    .from("debtors")
    .insert(debtorPayload)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  const debtorId = String((createdDebtor as any)?.id ?? "");
  if (!debtorId) return { ok: false, error: "Falha ao criar o cliente." };

  const autoScheduleResult = await syncDebtorChargesAndSchedules({
    supabase,
    userId,
    debtorId,
    charges,
    retryWeekdays: parsed.data.retry_weekdays,
    retryTime: parsed.data.retry_time,
    retryIntervalDays: parsed.data.retry_interval_days,
    timeZone: BRAZIL_TIMEZONES.includes((profile as any)?.timezone)
      ? ((profile as any).timezone as (typeof BRAZIL_TIMEZONES)[number])
      : null,
  });

  if (!autoScheduleResult.ok) {
    await supabase.from("debtor_charges").delete().eq("debtor_id", debtorId);
    await supabase.from("debtors").delete().eq("id", debtorId);
    return { ok: false, error: autoScheduleResult.error ?? "Falha ao iniciar a cobrança." };
  }

  return { ok: true, warning: autoScheduleResult.warning };
}

export async function updateDebtorAction(input: unknown) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    // #region debug-point E:update-parse-failed
    void (async () => {
      let url = "http://127.0.0.1:7777/event";
      let sessionId = "clientes-popup-save";
      try {
        const fs = await import("node:fs/promises");
        const env = await fs.readFile(".dbg/clientes-popup-save.env", "utf8");
        url = env.match(/DEBUG_SERVER_URL=(.+)/)?.[1] ?? url;
        sessionId = env.match(/DEBUG_SESSION_ID=(.+)/)?.[1] ?? sessionId;
      } catch {}
      await fetch(url, {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          runId: "pre-fix",
          hypothesisId: "E",
          location: "clientes/actions.ts:updateDebtorAction:parse-failed",
          msg: "[DEBUG] updateDebtorAction rejeitou payload no parse",
          data: {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path,
              message: issue.message,
              code: issue.code,
            })),
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
    })();
    // #endregion
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const charges = normalizeDebtorCharges(parsed.data);
  // #region debug-point A:update-start
  void (async () => {
    let url = "http://127.0.0.1:7777/event";
    let sessionId = "clientes-popup-save";
    try {
      const fs = await import("node:fs/promises");
      const env = await fs.readFile(".dbg/clientes-popup-save.env", "utf8");
      url = env.match(/DEBUG_SERVER_URL=(.+)/)?.[1] ?? url;
      sessionId = env.match(/DEBUG_SESSION_ID=(.+)/)?.[1] ?? sessionId;
    } catch {}
    await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        runId: "pre-fix",
        hypothesisId: "A",
        location: "clientes/actions.ts:updateDebtorAction:start",
        msg: "[DEBUG] updateDebtorAction iniciou",
        data: {
          debtorId: parsed.data.id,
          inputChargesCount: Array.isArray(parsed.data.charges) ? parsed.data.charges.length : 0,
          normalizedChargesCount: charges.length,
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
  })();
  // #endregion
  if (!charges.length) {
    return { ok: false, error: "Informe pelo menos 1 cobrança (valor e dia de vencimento)." };
  }

  const supabase = await createSupabaseServerClient();
  const { id, ...data } = parsed.data;
  const [{ data: userRes }, { data: profile }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("timezone").maybeSingle(),
  ]);
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const totalAmount = charges.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
  const { error } = await supabase
    .from("debtors")
    .update({
      nome: data.nome,
      telefone: data.telefone || null,
      valor: Number.isFinite(totalAmount) && totalAmount > 0 ? totalAmount : null,
      vencimento: null,
      pix_key: data.pix_key || null,
      observacoes: data.observacoes || null,
      status: data.status || "ativo",
      accumulate_open_monthly_charges: Boolean(data.accumulate_open_monthly_charges),
      skip_weekends_on_first_charge: Boolean(data.skip_weekends_on_first_charge),
      retry_weekdays: normalizeRetryWeekdays(data.retry_weekdays),
      retry_time: data.retry_time || DEFAULT_RETRY_TIME,
      retry_max_attempts: Math.min(
        MAX_RETRY_ATTEMPTS_PER_DAY,
        data.retry_max_attempts || DEFAULT_RETRY_MAX_ATTEMPTS,
      ),
      retry_interval_days: data.retry_interval_days || DEFAULT_RETRY_INTERVAL_DAYS,
      retry_auto_close_days: data.retry_auto_close_days || DEFAULT_RETRY_AUTO_CLOSE_DAYS,
    })
    .eq("id", id);
  // #region debug-point D:update-debtor-row
  void (async () => {
    let url = "http://127.0.0.1:7777/event";
    let sessionId = "clientes-popup-save";
    try {
      const fs = await import("node:fs/promises");
      const env = await fs.readFile(".dbg/clientes-popup-save.env", "utf8");
      url = env.match(/DEBUG_SERVER_URL=(.+)/)?.[1] ?? url;
      sessionId = env.match(/DEBUG_SESSION_ID=(.+)/)?.[1] ?? sessionId;
    } catch {}
    await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        runId: "pre-fix",
        hypothesisId: "D",
        location: "clientes/actions.ts:updateDebtorAction:debtors-update",
        msg: "[DEBUG] update na tabela debtors concluido",
        data: {
          debtorId: id,
          ok: !error,
          error: error?.message ?? null,
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
  })();
  // #endregion


  const autoScheduleResult = await syncDebtorChargesAndSchedules({
    supabase,
    userId,
    debtorId: id,
    charges,
    retryWeekdays: data.retry_weekdays,
    retryTime: data.retry_time,
    retryIntervalDays: data.retry_interval_days,
    timeZone: BRAZIL_TIMEZONES.includes((profile as any)?.timezone)
      ? ((profile as any).timezone as (typeof BRAZIL_TIMEZONES)[number])
      : null,
  });
  // #region debug-point D:update-sync-result
  void (async () => {
    let url = "http://127.0.0.1:7777/event";
    let sessionId = "clientes-popup-save";
    try {
      const fs = await import("node:fs/promises");
      const env = await fs.readFile(".dbg/clientes-popup-save.env", "utf8");
      url = env.match(/DEBUG_SERVER_URL=(.+)/)?.[1] ?? url;
      sessionId = env.match(/DEBUG_SESSION_ID=(.+)/)?.[1] ?? sessionId;
    } catch {}
    await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        runId: "pre-fix",
        hypothesisId: "D",
        location: "clientes/actions.ts:updateDebtorAction:sync-result",
        msg: "[DEBUG] sincronizacao de charges e schedules concluida",
        data: {
          debtorId: id,
          ok: autoScheduleResult.ok,
          error: "error" in autoScheduleResult ? (autoScheduleResult.error ?? null) : null,
          warning: "warning" in autoScheduleResult ? (autoScheduleResult.warning ?? null) : null,
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
  })();
  // #endregion

  if (!autoScheduleResult.ok) {
    return { ok: false, error: autoScheduleResult.error ?? "Falha ao iniciar a cobrança." };
  }

  return { ok: true, warning: autoScheduleResult.warning };
}

export async function deleteDebtorAction(id: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("debtors").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
