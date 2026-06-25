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
  normalizeRetryWeekdays,
} from "@/lib/chargeRetry";
import { syncDebtorChargeStatus } from "@/lib/debtorChargeStatus";
import { BRAZIL_TIMEZONES } from "@/lib/timezone";

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
}) {
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
    const { error: deleteChargesError } = await params.supabase.from("debtor_charges").delete().in("id", removedIds);
    if (deleteChargesError) return { ok: false as const, error: deleteChargesError.message };
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
  });

  if (!autoScheduleResult.ok) {
    await supabase.from("debtor_charges").delete().eq("debtor_id", debtorId);
    await supabase.from("debtors").delete().eq("id", debtorId);
    return { ok: false, error: autoScheduleResult.error ?? "Falha ao iniciar a cobrança." };
  }

  return { ok: true };
}

export async function updateDebtorAction(input: unknown) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const charges = normalizeDebtorCharges(parsed.data);
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

  const autoScheduleResult = await syncDebtorChargesAndSchedules({
    supabase,
    userId,
    debtorId: id,
    charges,
  });

  if (!autoScheduleResult.ok) {
    return { ok: false, error: autoScheduleResult.error ?? "Falha ao iniciar a cobrança." };
  }

  return { ok: true };
}

export async function deleteDebtorAction(id: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("debtors").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
