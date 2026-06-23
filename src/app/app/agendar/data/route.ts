import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildAgendaRows } from "@/lib/agendaRows";

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const [{ data: schedules }, { data: scheduleRuns }, { data: debtors }] = await Promise.all([
    supabase
      .from("schedules")
      .select(
        "id, debtor_id, charge_id, template_id, template_pending_id, template_overdue_id, data_envio, charge_due_at, status, recurrence, recurrence_until, recurrence_day, recurrence_time, schedule_timezone, last_sent_at, payment_received_at, created_at, closed_at, pending_template:message_templates!schedules_template_pending_id_fkey(nome), overdue_template:message_templates!schedules_template_overdue_id_fkey(nome)",
      )
      .order("data_envio", { ascending: true })
      .limit(200),
    supabase
      .from("schedule_runs")
      .select("schedule_id, scheduled_for")
      .eq("status", "executado")
      .order("scheduled_for", { ascending: false })
      .limit(2000),
    supabase
      .from("debtors")
      .select(
        "id, nome, retry_time, debtor_charges(id, due_day, recurrence_month, recurrence_year, created_at)",
      )
      .order("nome", { ascending: true })
      .limit(500),
  ]);

  const latestExecutedRunBySchedule = new Map<string, string>();
  for (const run of scheduleRuns ?? []) {
    const scheduleId = String((run as any)?.schedule_id ?? "");
    const scheduledFor = String((run as any)?.scheduled_for ?? "");
    if (!scheduleId || !scheduledFor || latestExecutedRunBySchedule.has(scheduleId)) continue;
    latestExecutedRunBySchedule.set(scheduleId, scheduledFor);
  }

  const rows = buildAgendaRows({
    debtors: (debtors ?? []) as any[],
    schedules: (schedules ?? []) as any[],
    latestExecutedRunBySchedule,
  });

  return Response.json(rows);
}
