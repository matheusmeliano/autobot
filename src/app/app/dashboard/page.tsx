import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/app/DashboardClient";
import { localDateInTimeZone } from "@/lib/recurrence";
import { buildAgendaRows } from "@/lib/agendaRows";
import { getScheduleChargeAmount } from "@/lib/chargeAccumulation";
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

function chargeMonthKey(charge: { recurrence_month?: unknown; recurrence_year?: unknown }) {
  const year = Number(charge.recurrence_year);
  const month = Number(charge.recurrence_month);
  if (!year || !month) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function isPaidSchedule(row: {
  status?: string | null;
  payment_received_at?: string | null;
  closed_at?: string | null;
}) {
  const status = String(row.status ?? "").trim().toLowerCase();
  if (status === "pago") return true;
  return Boolean(String(row.payment_received_at ?? "").trim());
}

function activitySortTime(activity: {
  operationalDueAt?: string | null;
  chargeDueAt?: string | null;
  dataEnvio?: string | null;
  lastExecutedScheduledFor?: string | null;
}, timeZone: BrazilTimeZone, currentMonthKey: string) {
  const operationalDueAt = String(activity.operationalDueAt ?? "").trim();
  const chargeDueAt = String(activity.chargeDueAt ?? "").trim();
  const dataEnvio = String(activity.dataEnvio ?? "").trim();
  const lastExecutedScheduledFor = String(activity.lastExecutedScheduledFor ?? "").trim();
  const operationalMonthKey = operationalDueAt ? scheduleLocalMonthKey(operationalDueAt, timeZone) : null;
  if (operationalMonthKey === currentMonthKey) {
    const time = new Date(operationalDueAt).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  const dueMoment = chargeDueAt || dataEnvio;
  const dueMonthKey = dueMoment ? scheduleLocalMonthKey(dueMoment, timeZone) : null;
  const executedMonthKey = lastExecutedScheduledFor
    ? scheduleLocalMonthKey(lastExecutedScheduledFor, timeZone)
    : null;
  if (executedMonthKey === currentMonthKey && dueMonthKey !== currentMonthKey) {
    const time = new Date(lastExecutedScheduledFor).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  const iso = dueMoment || lastExecutedScheduledFor;
  const time = new Date(String(iso)).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function activityCurrentMonthPriority(activity: {
  operationalDueAt?: string | null;
  chargeDueAt?: string | null;
  dataEnvio?: string | null;
  lastExecutedScheduledFor?: string | null;
}, timeZone: BrazilTimeZone, currentMonthKey: string) {
  const operationalDueAt = String(activity.operationalDueAt ?? "").trim();
  const chargeDueAt = String(activity.chargeDueAt ?? "").trim();
  const dataEnvio = String(activity.dataEnvio ?? "").trim();
  const lastExecutedScheduledFor = String(activity.lastExecutedScheduledFor ?? "").trim();
  const operationalMonthKey = operationalDueAt ? scheduleLocalMonthKey(operationalDueAt, timeZone) : null;
  if (operationalMonthKey === currentMonthKey) return 0;
  const dueMoment = chargeDueAt || dataEnvio;
  const dueMonthKey = dueMoment ? scheduleLocalMonthKey(dueMoment, timeZone) : null;
  const executedMonthKey = lastExecutedScheduledFor
    ? scheduleLocalMonthKey(lastExecutedScheduledFor, timeZone)
    : null;
  if (executedMonthKey === currentMonthKey && dueMonthKey !== currentMonthKey) return 0;
  return 1;
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
      .is("closed_at", null)
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
      .select(
        "id, nome, observacoes, valor, status, retry_time, accumulate_open_monthly_charges, debtor_charges(id, amount, due_day, recurrence_month, recurrence_year, created_at)",
      )
      .eq("user_id", userId)
      .limit(1000),
    supabase
      .from("schedules")
      .select(
        "id, debtor_id, charge_id, template_id, template_pending_id, template_overdue_id, data_envio, charge_due_at, status, recurrence, recurrence_until, recurrence_day, recurrence_time, schedule_timezone, last_sent_at, payment_received_at, created_at, closed_at, charge:debtor_charges!schedules_charge_id_fkey(due_day, recurrence_month, recurrence_year), pending_template:message_templates!schedules_template_pending_id_fkey(nome), overdue_template:message_templates!schedules_template_overdue_id_fkey(nome)",
      )
      .eq("user_id", userId)
      .limit(2000),
    supabase
      .from("schedules")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("closed_at", null)
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
  const effectiveTimeZone: BrazilTimeZone = timeZone ?? "America/Sao_Paulo";
  const currentMonthKey = localDateInTimeZone(now.toISOString(), effectiveTimeZone).slice(0, 7);

  let receivableMonthTotal = 0;
  let receivableMonthPaid = 0;

  const debtorsById = new Map<
    string,
    { valor: number | null; accumulate_open_monthly_charges?: boolean | null; charges: any[] }
  >();
  const chargeAmountById = new Map<string, number>();
  for (const debtor of (debtorsRes.data ?? []) as any[]) {
    const debtorId = String((debtor as any)?.id ?? "");
    if (!debtorId) continue;
    const charges = Array.isArray((debtor as any)?.debtor_charges) ? ((debtor as any).debtor_charges as any[]) : [];
    debtorsById.set(debtorId, {
      valor: typeof (debtor as any)?.valor === "number" && !Number.isNaN((debtor as any).valor) ? Number((debtor as any).valor) : null,
      accumulate_open_monthly_charges: Boolean((debtor as any)?.accumulate_open_monthly_charges),
      charges,
    });
    for (const c of charges) {
      const chargeId = String((c as any)?.id ?? "");
      const amount = Number((c as any)?.amount) || 0;
      if (chargeId && amount > 0) chargeAmountById.set(chargeId, amount);
    }
  }

  for (const schedule of schedules) {
    const debtorId = String((schedule as any)?.debtor_id ?? "");
    if (!debtorId) continue;

    const scheduleTimeZone = String((schedule as any)?.schedule_timezone ?? "") || effectiveTimeZone;
    const dueMonthKey = scheduleLocalMonthKey(
      String((schedule as any)?.charge_due_at ?? "") || String((schedule as any)?.data_envio ?? "") || null,
      scheduleTimeZone,
    );
    if (dueMonthKey !== currentMonthKey) continue;

    const debtor = debtorsById.get(debtorId) ?? null;
    const chargeId = String((schedule as any)?.charge_id ?? "");
    const baseAmount =
      (chargeId ? chargeAmountById.get(chargeId) ?? null : null) ??
      (debtor?.valor ?? null);
    if (baseAmount == null || baseAmount <= 0) continue;

    const amount = getScheduleChargeAmount({
      baseAmount,
      accumulateOpenMonthlyCharges: debtor?.accumulate_open_monthly_charges ?? null,
      recurrence: (schedule as any)?.recurrence ?? null,
      status: (schedule as any)?.status ?? null,
      closedAt: (schedule as any)?.closed_at ?? null,
      chargeDueAt: (schedule as any)?.charge_due_at ?? null,
      dataEnvio: (schedule as any)?.data_envio ?? null,
      nowUtcIso: now.toISOString(),
      timeZone: scheduleTimeZone,
    });
    if (amount == null || amount <= 0) continue;

    receivableMonthTotal += amount;
    if (isPaidSchedule(schedule as any)) {
      receivableMonthPaid += amount;
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
  })
    .map((row) => ({
      id: String(row.id),
      debtorName: String(row.debtor_nome ?? "-"),
      status: String(row.status ?? ""),
      dataEnvio: String(row.data_envio ?? ""),
      chargeDueAt: row.charge_due_at ? String(row.charge_due_at) : null,
      operationalDueAt: row.operational_due_at ? String(row.operational_due_at) : null,
      lastExecutedScheduledFor: row.last_executed_scheduled_for
        ? String(row.last_executed_scheduled_for)
        : null,
      paymentReceivedAt: row.payment_received_at ? String(row.payment_received_at) : null,
    }))
    .sort((a, b) => {
      const priorityDiff =
        activityCurrentMonthPriority(a, effectiveTimeZone, currentMonthKey) -
        activityCurrentMonthPriority(b, effectiveTimeZone, currentMonthKey);
      if (priorityDiff !== 0) return priorityDiff;
      return (
        activitySortTime(b, effectiveTimeZone, currentMonthKey) -
        activitySortTime(a, effectiveTimeZone, currentMonthKey)
      );
    });

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
