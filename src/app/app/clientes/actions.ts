"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizePlan } from "@/lib/plans";
import {
  DEFAULT_RETRY_AUTO_CLOSE_DAYS,
  DEFAULT_RETRY_INTERVAL_DAYS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_TIME,
  normalizeRetryWeekdays,
} from "@/lib/chargeRetry";

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
  retry_max_attempts: z.coerce.number().int().min(1).max(100).optional(),
  retry_interval_days: z.coerce.number().int().min(1).max(365).optional(),
  retry_auto_close_days: z.coerce.number().int().min(1).max(365).optional(),
});

const updateSchema = createSchema.extend({
  id: z.string().uuid(),
});

export async function createDebtorAction(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase.from("profiles").select("plano").maybeSingle();
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

  const { error } = await supabase.from("debtors").insert({
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
    retry_max_attempts: parsed.data.retry_max_attempts || DEFAULT_RETRY_MAX_ATTEMPTS,
    retry_interval_days: DEFAULT_RETRY_INTERVAL_DAYS,
    retry_auto_close_days: parsed.data.retry_auto_close_days || DEFAULT_RETRY_AUTO_CLOSE_DAYS,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateDebtorAction(input: unknown) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createSupabaseServerClient();
  const { id, ...data } = parsed.data;

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
      retry_max_attempts: data.retry_max_attempts || DEFAULT_RETRY_MAX_ATTEMPTS,
      retry_interval_days: DEFAULT_RETRY_INTERVAL_DAYS,
      retry_auto_close_days: data.retry_auto_close_days || DEFAULT_RETRY_AUTO_CLOSE_DAYS,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteDebtorAction(id: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("debtors").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
