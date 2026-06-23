import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SchedulesClient,
  type DebtorOption,
  type ScheduleRow,
  type TemplateOption,
} from "@/components/app/schedules/SchedulesClient";
import { buildAgendaRows } from "@/lib/agendaRows";
import { BRAZIL_TIMEZONES, type BrazilTimeZone } from "@/lib/timezone";

export default async function AgendarPage() {
  const supabase = await createSupabaseServerClient();

  const [schedulesRes, scheduleRunsRes, debtorsRes, templatesRes, profileRes, waRes] = await Promise.all([
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
        "id, nome, retry_weekdays, retry_time, retry_max_attempts, retry_interval_days, retry_auto_close_days, debtor_charges(id, due_day, recurrence_month, recurrence_year, created_at)",
      )
      .order("nome", { ascending: true })
      .limit(500),
    supabase
      .from("message_templates")
      .select("id, nome")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("timezone").maybeSingle(),
    supabase.from("whatsapp_instances").select("instance_id, token, status").maybeSingle(),
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

  const initial = buildAgendaRows({
    debtors: (debtorsRes.data ?? []) as any[],
    schedules: (schedulesRes.data ?? []) as any[],
    latestExecutedRunBySchedule,
  });

  const tzRaw = (profileRes as any)?.data?.timezone;
  const timeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? (tzRaw as BrazilTimeZone) : null;
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
