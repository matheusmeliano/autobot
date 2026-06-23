import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applyCurrentMonthDebtorStatuses } from "@/lib/debtorChargeStatus";

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const [{ data: debtors }, { data: schedules }] = await Promise.all([
    supabase
      .from("debtors")
      .select(
        "id, nome, telefone, valor, vencimento, pix_key, observacoes, status, accumulate_open_monthly_charges, skip_weekends_on_first_charge, retry_weekdays, retry_time, retry_max_attempts, retry_interval_days, retry_auto_close_days, created_at, debtor_charges(id, amount, due_day, recurrence_month, recurrence_year, created_at)",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("schedules")
      .select("debtor_id, charge_id, status, recurrence, data_envio, charge_due_at, payment_received_at, schedule_timezone, closed_at")
      .limit(1000),
  ]);

  return Response.json(
    applyCurrentMonthDebtorStatuses({
      debtors: ((debtors ?? []) as any[]).map((row) => ({
        ...row,
        status: String(row?.status ?? "ativo"),
        charges: ((row as any)?.debtor_charges ?? []).map((c: any) => ({
          ...c,
          amount: typeof c?.amount === "number" ? c.amount : Number(c?.amount),
          due_day: typeof c?.due_day === "number" ? c.due_day : Number(c?.due_day),
          recurrence_month: typeof c?.recurrence_month === "number" ? c.recurrence_month : Number(c?.recurrence_month),
          recurrence_year: typeof c?.recurrence_year === "number" ? c.recurrence_year : Number(c?.recurrence_year),
        })),
      })),
      schedules: (schedules ?? []) as any[],
    }),
  );
}
