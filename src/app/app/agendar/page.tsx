import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SchedulesClient,
  type DebtorOption,
  type ScheduleRow,
  type TemplateOption,
} from "@/components/app/schedules/SchedulesClient";
import { buildAgendaRows } from "@/lib/agendaRows";
import {
  listAllAgendarDebtors,
  listAllAgendarScheduleRuns,
  listAllAgendarSchedules,
  listAllAgendarTemplates,
} from "@/lib/agendarData";
import { BRAZIL_TIMEZONES, type BrazilTimeZone } from "@/lib/timezone";

export default async function AgendarPage() {
  const supabase = await createSupabaseServerClient();

  const [schedulesRes, scheduleRunsRes, debtorsRes, templatesRes, profileRes, waRes] = await Promise.all([
    listAllAgendarSchedules(supabase),
    listAllAgendarScheduleRuns(supabase),
    listAllAgendarDebtors(supabase),
    listAllAgendarTemplates(supabase),
    supabase.from("profiles").select("timezone").maybeSingle(),
    supabase
      .from("whatsapp_instances")
      .select("instance_id, token, status")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (schedulesRes.error || scheduleRunsRes.error || debtorsRes.error || templatesRes.error) {
    return (
      <div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">Agendamentos</h1>
        <div className="mt-2 text-sm text-white/60">
          Não foi possível carregar seus dados. Verifique se as tabelas existem e se você está
          logado.
        </div>
      </div>
    );
  }

  const latestExecutedRunBySchedule = new Map<string, string>();
  for (const run of scheduleRunsRes.data ?? []) {
    const scheduleId = String((run as any)?.schedule_id ?? "");
    const scheduledFor = String((run as any)?.scheduled_for ?? "");
    if (!scheduleId || !scheduledFor || latestExecutedRunBySchedule.has(scheduleId)) continue;
    latestExecutedRunBySchedule.set(scheduleId, scheduledFor);
  }

  const tzRaw = (profileRes as any)?.data?.timezone;
  const timeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? (tzRaw as BrazilTimeZone) : null;
  const initial = buildAgendaRows({
    debtors: (debtorsRes.data ?? []) as any[],
    schedules: (schedulesRes.data ?? []) as any[],
    latestExecutedRunBySchedule,
    templates: (templatesRes.data ?? []) as any[],
    defaultTimeZone: timeZone,
  });
  const wa = (waRes as any)?.data ?? null;
  const waStatus = String(wa?.status ?? "").toLowerCase();
  const whatsappConfigured = Boolean(
    wa?.instance_id && wa?.token && (waStatus === "configured" || waStatus === "connected"),
  );

  return (
    <SchedulesClient
      initial={initial as ScheduleRow[]}
      debtors={(debtorsRes.data ?? []) as DebtorOption[]}
      templates={(templatesRes.data ?? []) as TemplateOption[]}
      timeZone={timeZone}
      whatsappConfigured={whatsappConfigured}
    />
  );
}
