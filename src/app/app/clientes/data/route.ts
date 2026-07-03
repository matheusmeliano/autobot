import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applyCurrentMonthDebtorStatuses } from "@/lib/debtorChargeStatus";
import { listAllClientesDebtors, listAllClientesScheduleRuns, listAllClientesSchedules } from "@/lib/clientesData";

function compareCreatedAtDesc(a: { created_at?: string | null }, b: { created_at?: string | null }) {
  return new Date(String(b.created_at ?? "")).getTime() - new Date(String(a.created_at ?? "")).getTime();
}

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const [{ data: debtors, error: debtorsError }, { data: schedules, error: schedulesError }, { data: scheduleRuns, error: scheduleRunsError }] = await Promise.all([
    listAllClientesDebtors(supabase),
    listAllClientesSchedules(supabase),
    listAllClientesScheduleRuns(supabase),
  ]);

  if (debtorsError || schedulesError || scheduleRunsError) {
    return Response.json(
      {
        error:
          debtorsError?.message ??
          schedulesError?.message ??
          scheduleRunsError?.message ??
          "Falha ao carregar clientes.",
      },
      { status: 500 },
    );
  }

  const latestExecutedRunBySchedule = new Map<string, string>();
  for (const run of (scheduleRuns ?? []) as any[]) {
    const scheduleId = String((run as any)?.schedule_id ?? "").trim();
    const scheduledFor = String((run as any)?.scheduled_for ?? "").trim();
    if (!scheduleId || !scheduledFor || latestExecutedRunBySchedule.has(scheduleId)) continue;
    latestExecutedRunBySchedule.set(scheduleId, scheduledFor);
  }
  const schedulesWithRuns = ((schedules ?? []) as any[]).map((schedule) => ({
    ...schedule,
    last_executed_scheduled_for:
      latestExecutedRunBySchedule.get(String((schedule as any)?.id ?? "").trim()) ?? null,
  }));

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
      schedules: schedulesWithRuns as any[],
    }).sort(compareCreatedAtDesc),
  );
}
