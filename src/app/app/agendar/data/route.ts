import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildAgendaRows } from "@/lib/agendaRows";
import {
  listAllAgendarDebtors,
  listAllAgendarScheduleRuns,
  listAllAgendarSchedules,
  listAllAgendarTemplates,
} from "@/lib/agendarData";
import { BRAZIL_TIMEZONES } from "@/lib/timezone";

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const [
    { data: schedules, error: schedulesError },
    { data: scheduleRuns, error: scheduleRunsError },
    { data: debtors, error: debtorsError },
    { data: templates, error: templatesError },
    profileRes,
  ] = await Promise.all([
    listAllAgendarSchedules(supabase),
    listAllAgendarScheduleRuns(supabase),
    listAllAgendarDebtors(supabase),
    listAllAgendarTemplates(supabase),
    supabase.from("profiles").select("timezone").maybeSingle(),
  ]);

  if (schedulesError || scheduleRunsError || debtorsError || templatesError) {
    return Response.json(
      {
        error:
          schedulesError?.message ??
          scheduleRunsError?.message ??
          debtorsError?.message ??
          templatesError?.message ??
          "Falha ao carregar agendamentos.",
      },
      { status: 500 },
    );
  }

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
    templates: (templates ?? []) as any[],
    defaultTimeZone: BRAZIL_TIMEZONES.includes((profileRes as any)?.data?.timezone)
      ? ((profileRes as any).data.timezone as (typeof BRAZIL_TIMEZONES)[number])
      : null,
  });

  return Response.json(rows);
}
