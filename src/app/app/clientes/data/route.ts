import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applyCurrentMonthDebtorStatuses } from "@/lib/debtorChargeStatus";

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const [{ data: debtors }, { data: schedules }] = await Promise.all([
    supabase
      .from("debtors")
      .select(
        "id, nome, telefone, valor, vencimento, pix_key, observacoes, status, retry_weekdays, retry_time, retry_max_attempts, retry_interval_days, retry_auto_close_days, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("schedules")
      .select("debtor_id, status, data_envio, charge_due_at, payment_received_at, schedule_timezone")
      .limit(1000),
  ]);

  return Response.json(
    applyCurrentMonthDebtorStatuses({
      debtors: ((debtors ?? []) as any[]).map((row) => ({
        ...row,
        status: String(row?.status ?? "ativo"),
      })),
      schedules: (schedules ?? []) as any[],
    }),
  );
}
