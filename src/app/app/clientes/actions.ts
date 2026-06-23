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

const createSchema = z.object({
  nome: z.string().min(2),
  telefone: z.string().optional(),
  valor: z.coerce.number().optional(),
  vencimento: z.string().optional(),
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
});

const updateSchema = createSchema.extend({
  id: z.string().uuid(),
});

type TemplateChoice = {
  id: string;
  nome?: string | null;
  created_at?: string | null;
};

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
}) {
  const retryWeekdays = normalizeRetryWeekdays(params.retryWeekdays);
  const retryTime = validTime(String(params.retryTime ?? "")) ? String(params.retryTime) : DEFAULT_RETRY_TIME;
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
    intervalDays: DEFAULT_RETRY_INTERVAL_DAYS,
  });
}

async function ensureCurrentMonthOverdueSchedule(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  debtorId: string;
  dueDate?: string | null;
  retryWeekdays?: number[];
  retryTime?: string;
  nowUtcIso?: string;
  timeZone?: string | null;
}) {
  const dueDate = String(params.dueDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { ok: true as const };

  const nowUtcIso = params.nowUtcIso ?? new Date().toISOString();
  const timeZone =
    params.timeZone && BRAZIL_TIMEZONES.includes(params.timeZone as (typeof BRAZIL_TIMEZONES)[number])
      ? params.timeZone
      : "America/Sao_Paulo";
  const currentLocalDate = localDateInTimeZone(nowUtcIso, timeZone);

  if (dueDate.slice(0, 7) !== currentLocalDate.slice(0, 7) || dueDate >= currentLocalDate) {
    return { ok: true as const };
  }

  const { data: existingSchedule, error: existingScheduleError } = await params.supabase
    .from("schedules")
    .select("id")
    .eq("debtor_id", params.debtorId)
    .is("closed_at", null)
    .limit(1)
    .maybeSingle();
  if (existingScheduleError) return { ok: false as const, error: existingScheduleError.message };
  if (existingSchedule?.id) return { ok: true as const };

  const { data: templates, error: templatesError } = await params.supabase
    .from("message_templates")
    .select("id, nome, created_at")
    .order("created_at", { ascending: true })
    .limit(20);
  if (templatesError) return { ok: false as const, error: templatesError.message };

  const templateIds = resolveChargeTemplateIds((templates ?? []) as TemplateChoice[]);
  if (!templateIds.pendingId || !templateIds.overdueId) {
    return {
      ok: true as const,
      warning:
        "Cliente criado, mas sem template suficiente para iniciar automaticamente a cobrança em atraso. Configure seus templates em Mensagens.",
    };
  }

  const retryTime = validTime(String(params.retryTime ?? "")) ? String(params.retryTime) : DEFAULT_RETRY_TIME;
  const scheduleAt = nextInitialOverdueAttemptUtcIso({
    nowUtcIso,
    timeZone,
    retryWeekdays: params.retryWeekdays,
    retryTime,
  });
  const dueAt = zonedDateTimeToUtcIso({
    date: currentLocalDate,
    time: retryTime,
    timeZone,
  });
  const recurrenceDay = Number(dueDate.slice(8, 10) ?? "1");

  const { error: scheduleError } = await params.supabase.from("schedules").insert({
    debtor_id: params.debtorId,
    template_id: templateIds.pendingId,
    template_pending_id: templateIds.pendingId,
    template_overdue_id: templateIds.overdueId,
    data_envio: scheduleAt,
    charge_due_at: dueAt,
    recurrence: "monthly",
    schedule_timezone: timeZone,
    recurrence_day: Number.isFinite(recurrenceDay) ? recurrenceDay : 1,
    recurrence_time: retryTime,
    recurrence_until: null,
    status: "atrasado",
  });

  if (scheduleError) return { ok: false as const, error: scheduleError.message };

  await syncDebtorChargeStatus(createSupabaseAdminClient(), params.userId, params.debtorId);
  return { ok: true as const };
}

export async function createDebtorAction(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
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

  const debtorPayload = {
    nome: parsed.data.nome,
    telefone: parsed.data.telefone || null,
    valor: typeof parsed.data.valor === "number" ? parsed.data.valor : null,
    vencimento: parsed.data.vencimento || null,
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
    retry_interval_days: DEFAULT_RETRY_INTERVAL_DAYS,
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

  const autoScheduleResult = await ensureCurrentMonthOverdueSchedule({
    supabase,
    userId,
    debtorId,
    dueDate: parsed.data.vencimento ?? null,
    retryWeekdays: parsed.data.retry_weekdays,
    retryTime: parsed.data.retry_time,
    timeZone: BRAZIL_TIMEZONES.includes((profile as any)?.timezone)
      ? ((profile as any).timezone as (typeof BRAZIL_TIMEZONES)[number])
      : null,
  });

  if (!autoScheduleResult.ok) {
    await supabase.from("debtors").delete().eq("id", debtorId);
    return { ok: false, error: autoScheduleResult.error ?? "Falha ao iniciar a cobrança." };
  }

  return { ok: true, warning: autoScheduleResult.warning };
}

export async function updateDebtorAction(input: unknown) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createSupabaseServerClient();
  const { id, ...data } = parsed.data;
  const [{ data: userRes }, { data: profile }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("timezone").maybeSingle(),
  ]);
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const { error } = await supabase
    .from("debtors")
    .update({
      nome: data.nome,
      telefone: data.telefone || null,
      valor: typeof data.valor === "number" ? data.valor : null,
      vencimento: data.vencimento || null,
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
      retry_interval_days: DEFAULT_RETRY_INTERVAL_DAYS,
      retry_auto_close_days: data.retry_auto_close_days || DEFAULT_RETRY_AUTO_CLOSE_DAYS,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  const autoScheduleResult = await ensureCurrentMonthOverdueSchedule({
    supabase,
    userId,
    debtorId: id,
    dueDate: data.vencimento ?? null,
    retryWeekdays: data.retry_weekdays,
    retryTime: data.retry_time,
    timeZone: BRAZIL_TIMEZONES.includes((profile as any)?.timezone)
      ? ((profile as any).timezone as (typeof BRAZIL_TIMEZONES)[number])
      : null,
  });

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
