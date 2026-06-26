import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applyCurrentMonthDebtorStatuses } from "@/lib/debtorChargeStatus";
import { listAllClientesDebtors, listAllClientesSchedules } from "@/lib/clientesData";

function compareCreatedAtDesc(a: { created_at?: string | null }, b: { created_at?: string | null }) {
  return new Date(String(b.created_at ?? "")).getTime() - new Date(String(a.created_at ?? "")).getTime();
}

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const [{ data: debtors, error: debtorsError }, { data: schedules, error: schedulesError }] = await Promise.all([
    listAllClientesDebtors(supabase),
    listAllClientesSchedules(supabase),
  ]);

  if (debtorsError || schedulesError) {
    return Response.json(
      { error: debtorsError?.message ?? schedulesError?.message ?? "Falha ao carregar clientes." },
      { status: 500 },
    );
  }

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
    }).sort(compareCreatedAtDesc),
  );
}
