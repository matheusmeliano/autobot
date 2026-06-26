import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getScheduleChargeAmount } from "@/lib/chargeAccumulation";
import { localDateInTimeZone } from "@/lib/recurrence";

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

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("payment_suspicions")
    .select(
      "id, schedule_id, debtor_id, from_phone, message_text, media_url, ai_confidence, ai_reason, created_at, schedule:schedules(id, data_envio, charge_due_at, status, recurrence, schedule_timezone, closed_at, payment_received_at, charge:debtor_charges!schedules_charge_id_fkey(amount, due_day, recurrence_month, recurrence_year)), debtor:debtors(nome, telefone, valor, vencimento, accumulate_open_monthly_charges)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!data?.id) {
    return Response.json({ ok: true, pending: null });
  }

  const schedule = (data as any).schedule ?? null;
  const debtor = (data as any).debtor ?? null;
  const timeZone = String(schedule?.schedule_timezone ?? "") || "America/Sao_Paulo";
  const dueLocalDate = (() => {
    const raw = String(schedule?.charge_due_at ?? schedule?.data_envio ?? "").trim();
    if (!raw) return "";
    try {
      return localDateInTimeZone(raw, timeZone);
    } catch {
      return "";
    }
  })();
  const amount = getScheduleChargeAmount({
    baseAmount: schedule?.charge?.amount ?? debtor?.valor,
    accumulateOpenMonthlyCharges: debtor?.accumulate_open_monthly_charges,
    recurrence: schedule?.recurrence,
    status: schedule?.status,
    closedAt: schedule?.closed_at,
    chargeDueAt: schedule?.charge_due_at,
    dataEnvio: schedule?.data_envio,
    nowUtcIso: new Date().toISOString(),
    timeZone,
  });

  return Response.json({
    ok: true,
    pending: {
      id: String((data as any).id),
      created_at: String((data as any).created_at ?? ""),
      from_phone: (data as any).from_phone ?? null,
      message_text: (data as any).message_text ?? null,
      media_url: (data as any).media_url ?? null,
      ai_confidence: (data as any).ai_confidence ?? null,
      ai_reason: (data as any).ai_reason ?? null,
      schedule,
      debtor,
      due_local_date: dueLocalDate || null,
      due_date_br: dueLocalDate ? formatDateBR(dueLocalDate) : null,
      amount: amount ?? null,
      amount_brl: amount != null ? formatBRL(amount) : null,
    },
  });
}
