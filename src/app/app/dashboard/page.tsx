import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/app/DashboardClient";
import { applyCurrentMonthDebtorStatuses } from "@/lib/debtorChargeStatus";
import { localDateInTimeZone } from "@/lib/recurrence";
import { buildAgendaRows } from "@/lib/agendaRows";
import { BRAZIL_TIMEZONES, type BrazilTimeZone } from "@/lib/timezone";

function scheduleLocalMonthKey(value: string | null | undefined, timeZone: string) {
  const iso = String(value ?? "").trim();
  if (!iso) return null;
  try {
    return localDateInTimeZone(iso, timeZone).slice(0, 7);
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email ?? "";
  const userId = user?.id ?? null;

  if (!userId) {
    return (
      <DashboardClient
        email={email}
        name=""
        stats={{
          clients: 0,
          activeSchedules: 0,
          templates: 0,
          whatsappStatus: "disconnected",
          receivableMonthTotal: 0,
          receivableMonthPaid: 0,
          receivableMonthRemaining: 0,
        }}
        chartDates={[]}
        activities={[]}
        timeZone={null}
      />
    );
  }

  const now = new Date();

  const [
    templatesRes,
    chartRes,
    whatsappRes,
    profileRes,
    scheduleRunsRes,
    debtorsRes,
    schedulesRes,
    activeSchedulesRes,
  ] = await Promise.all([
    supabase
      .from("message_templates")
      .select("id, nome, created_at")
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("schedules")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(5000),
    supabase.from("whatsapp_instances").select("status").maybeSingle(),
    supabase.from("profiles").select("nome, timezone").eq("user_id", userId).maybeSingle(),
    supabase
      .from("schedule_runs")
      .select("schedule_id, scheduled_for")
      .eq("status", "executado")
      .order("scheduled_for", { ascending: false })
      .limit(2000),
    supabase
      .from("debtors")
      .select("id, nome, observacoes, valor, status, retry_time, accumulate_open_monthly_charges, debtor_charges(id, due_day, recurrence_month, recurrence_year, created_at)")
      .eq("user_id", userId)
      .limit(1000),
    supabase
      .from("schedules")
      .select(
        "id, debtor_id, charge_id, template_id, template_pending_id, template_overdue_id, data_envio, charge_due_at, status, recurrence, recurrence_until, recurrence_day, recurrence_time, schedule_timezone, last_sent_at, payment_received_at, created_at, closed_at, pending_template:message_templates!schedules_template_pending_id_fkey(nome), overdue_template:message_templates!schedules_template_overdue_id_fkey(nome)",
      )
      .eq("user_id", userId)
      .limit(2000),
    supabase
      .from("schedules")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["agendado", "pendente", "atrasado", "suspeita_de_pagamento", "executando"]),
  ]);

  const schedules = (schedulesRes.data ?? []) as any[];
  const latestExecutedRunBySchedule = new Map<string, string>();
  for (const run of scheduleRunsRes.data ?? []) {
    const scheduleId = String((run as any)?.schedule_id ?? "");
    const scheduledFor = String((run as any)?.scheduled_for ?? "");
    if (!scheduleId || !scheduledFor || latestExecutedRunBySchedule.has(scheduleId)) continue;
    latestExecutedRunBySchedule.set(scheduleId, scheduledFor);
  }
  const tzRaw = (profileRes as any)?.data?.timezone;
  const timeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? (tzRaw as BrazilTimeZone) : null;
  const currentMonthKey = localDateInTimeZone(now.toISOString(), "America/Sao_Paulo").slice(0, 7);
  const schedulesByDebtor = new Map<string, any[]>();

  for (const schedule of schedules) {
    const debtorId = String((schedule as any)?.debtor_id ?? "");
    if (!debtorId) continue;
    const list = schedulesByDebtor.get(debtorId) ?? [];
    list.push(schedule);
    schedulesByDebtor.set(debtorId, list);
  }

  const derivedDebtors = applyCurrentMonthDebtorStatuses({
    debtors: ((debtorsRes.data ?? []) as any[]).map((d) => ({
      ...d,
      status: String(d?.status ?? "ativo"),
      charges: ((d as any)?.debtor_charges ?? []).map((c: any) => ({
        ...c,
        due_day: typeof c?.due_day === "number" ? c.due_day : Number(c?.due_day),
        recurrence_month: typeof c?.recurrence_month === "number" ? c.recurrence_month : Number(c?.recurrence_month),
        recurrence_year: typeof c?.recurrence_year === "number" ? c.recurrence_year : Number(c?.recurrence_year),
      })),
    })),
    schedules: schedules as any[],
  }) as Array<{
    id: string;
    status: string;
    valor: number | null;
  }>;

  let receivableMonthTotal = 0;
  let receivableMonthPaid = 0;

  for (const d of derivedDebtors) {
    if (typeof d.valor !== "number" || Number.isNaN(d.valor)) continue;
    const debtorSchedules = schedulesByDebtor.get(String(d.id)) ?? [];
    const hasCurrentMonthCharge = debtorSchedules.some((row) => {
      const timeZone = String((row as any)?.schedule_timezone ?? "") || "America/Sao_Paulo";
      const dueMonthKey = scheduleLocalMonthKey(
        String((row as any)?.charge_due_at ?? "") || String((row as any)?.data_envio ?? "") || null,
        timeZone,
      );
      const paymentMonthKey = scheduleLocalMonthKey(
        String((row as any)?.payment_received_at ?? "") || null,
        timeZone,
      );
      return dueMonthKey === currentMonthKey || paymentMonthKey === currentMonthKey;
    });

    if (!hasCurrentMonthCharge) continue;

    const hasCurrentMonthPayment = debtorSchedules.some((row) => {
      const timeZone = String((row as any)?.schedule_timezone ?? "") || "America/Sao_Paulo";
      const paymentMonthKey = scheduleLocalMonthKey(
        String((row as any)?.payment_received_at ?? "") || null,
        timeZone,
      );
      if (paymentMonthKey === currentMonthKey) return true;

      const dueMonthKey = scheduleLocalMonthKey(
        String((row as any)?.charge_due_at ?? "") || String((row as any)?.data_envio ?? "") || null,
        timeZone,
      );
      return String((row as any)?.status ?? "").trim().toLowerCase() === "pago" && dueMonthKey === currentMonthKey;
    });

    receivableMonthTotal += d.valor;
    if (hasCurrentMonthPayment) {
      receivableMonthPaid += d.valor;
    }
  }

  const receivableMonthRemaining = Math.max(0, receivableMonthTotal - receivableMonthPaid);

  const stats = {
    clients: (debtorsRes.data ?? []).length,
    templates: (templatesRes.data ?? []).length,
    activeSchedules: activeSchedulesRes.count ?? 0,
    whatsappStatus: whatsappRes.data?.status ?? "disconnected",
    receivableMonthTotal,
    receivableMonthPaid,
    receivableMonthRemaining,
  };

  const chartDates = ((chartRes.data ?? []) as Array<{ created_at: string }>).map((row) =>
    String(row.created_at ?? ""),
  );

  const activities = buildAgendaRows({
    debtors: (debtorsRes.data ?? []) as any[],
    schedules,
    latestExecutedRunBySchedule,
    templates: (templatesRes.data ?? []) as any[],
    defaultTimeZone: timeZone,
  }).map((row) => ({
    id: String(row.id),
    debtorName: String(row.debtor_nome ?? "-"),
    status: String(row.status ?? ""),
    dataEnvio: String(row.data_envio ?? ""),
    chargeDueAt: row.charge_due_at ? String(row.charge_due_at) : null,
    lastExecutedScheduledFor: row.last_executed_scheduled_for
      ? String(row.last_executed_scheduled_for)
      : null,
    paymentReceivedAt: row.payment_received_at ? String(row.payment_received_at) : null,
  }));

  return (
    <DashboardClient
      email={email}
      name={(profileRes as any)?.data?.nome ?? ""}
      stats={stats}
      chartDates={chartDates}
      activities={activities}
      timeZone={timeZone}
    />
  );
}
