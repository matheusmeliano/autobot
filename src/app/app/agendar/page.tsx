import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SchedulesClient,
  type DebtorOption,
  type ScheduleRow,
  type TemplateOption,
} from "@/components/app/schedules/SchedulesClient";
import { BRAZIL_TIMEZONES, type BrazilTimeZone } from "@/lib/timezone";

export default async function AgendarPage() {
  const supabase = await createSupabaseServerClient();

  const [schedulesRes, debtorsRes, templatesRes, profileRes, waRes] = await Promise.all([
    supabase
      .from("schedules")
      .select(
        "id, debtor_id, template_id, template_pending_id, template_overdue_id, data_envio, status, recurrence, recurrence_until, recurrence_day, recurrence_time, schedule_timezone, created_at, debtors(nome), pending_template:message_templates!schedules_template_pending_id_fkey(nome), overdue_template:message_templates!schedules_template_overdue_id_fkey(nome)",
      )
      .order("data_envio", { ascending: true })
      .limit(200),
    supabase.from("debtors").select("id, nome").order("nome", { ascending: true }).limit(500),
    supabase
      .from("message_templates")
      .select("id, nome")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("timezone").maybeSingle(),
    supabase.from("whatsapp_instances").select("instance_id, token, status").maybeSingle(),
  ]);

  if (schedulesRes.error || debtorsRes.error || templatesRes.error) {
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

  const initial =
    (schedulesRes.data ?? []).map((r: any) => ({
      id: r.id,
      debtor_id: r.debtor_id,
      template_id: r.template_id,
      template_pending_id: r.template_pending_id ?? null,
      template_overdue_id: r.template_overdue_id ?? null,
      data_envio: r.data_envio,
      status: r.status,
      recurrence: r.recurrence ?? "none",
      recurrence_until: r.recurrence_until ?? null,
      recurrence_day: r.recurrence_day ?? null,
      recurrence_time: r.recurrence_time ?? null,
      schedule_timezone: r.schedule_timezone ?? null,
      created_at: r.created_at,
      debtor_nome: r.debtors?.nome ?? "-",
      template_nome: r.pending_template?.nome ?? null,
      template_pending_nome: r.pending_template?.nome ?? null,
      template_overdue_nome: r.overdue_template?.nome ?? null,
    })) ?? [];

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
