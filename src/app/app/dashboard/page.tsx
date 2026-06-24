import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/app/DashboardClient";
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

function chargeMonthKey(charge: { recurrence_month?: unknown; recurrence_year?: unknown }) {
  const year = Number(charge.recurrence_year);
  const month = Number(charge.recurrence_month);
  if (!year || !month) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function activitySortTime(activity: {
  chargeDueAt?: string | null;
  dataEnvio?: string | null;
}) {
  const iso = activity.chargeDueAt ?? activity.dataEnvio ?? "";
  const time = new Date(String(iso)).getTime();
  return Number.isNaN(time) ? 0 : time;
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
      .select(
        "id, nome, observacoes, valor, status, retry_time, accumulate_open_monthly_charges, debtor_charges(id, amount, due_day, recurrence_month, recurrence_year, created_at)",
      )
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
  const effectiveTimeZone: BrazilTimeZone = timeZone ?? "America/Sao_Paulo";
  const currentMonthKey = localDateInTimeZone(now.toISOString(), effectiveTimeZone).slice(0, 7);
  const schedulesByDebtor = new Map<string, any[]>();

  for (const schedule of schedules) {
    const debtorId = String((schedule as any)?.debtor_id ?? "");
    if (!debtorId) continue;
    const list = schedulesByDebtor.get(debtorId) ?? [];
    list.push(schedule);
    schedulesByDebtor.set(debtorId, list);
  }

  let receivableMonthTotal = 0;
  let receivableMonthPaid = 0;

  for (const debtor of (debtorsRes.data ?? []) as any[]) {
    const debtorSchedules = schedulesByDebtor.get(String((debtor as any)?.id ?? "")) ?? [];
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

    const currentMonthCharges = Array.isArray((debtor as any)?.debtor_charges)
      ? ((debtor as any).debtor_charges as any[]).filter((charge) => chargeMonthKey(charge) === currentMonthKey)
      : [];
    const currentMonthAmount = currentMonthCharges.reduce(
      (sum, charge) => sum + (Number((charge as any)?.amount) || 0),
      0,
    );

    const fallbackAmount =
      currentMonthAmount > 0
        ? currentMonthAmount
        : typeof (debtor as any)?.valor === "number" && !Number.isNaN((debtor as any).valor)
          ? Number((debtor as any).valor)
          : 0;

    if (fallbackAmount <= 0) continue;

    let currentMonthPaidAmount = 0;
    for (const charge of currentMonthCharges) {
      const chargeId = String((charge as any)?.id ?? "");
      if (!chargeId) continue;
      const chargeAmount = Number((charge as any)?.amount) || 0;
      if (chargeAmount <= 0) continue;
      const chargePaid = debtorSchedules.some((row) => {
        if (String((row as any)?.charge_id ?? "") !== chargeId) return false;
        const timeZone = String((row as any)?.schedule_timezone ?? "") || effectiveTimeZone;
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
      if (chargePaid) currentMonthPaidAmount += chargeAmount;
    }

    if (!currentMonthCharges.length) {
      const hasCurrentMonthPayment = debtorSchedules.some((row) => {
        const timeZone = String((row as any)?.schedule_timezone ?? "") || effectiveTimeZone;
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

      receivableMonthTotal += fallbackAmount;
      if (hasCurrentMonthPayment) {
        receivableMonthPaid += fallbackAmount;
      }
      continue;
    }

    receivableMonthTotal += fallbackAmount;
    receivableMonthPaid += Math.min(fallbackAmount, currentMonthPaidAmount);
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
      lastExecutedScheduledFor: row.last_executed_scheduled_for
        ? String(row.last_executed_scheduled_for)
        : null,
      paymentReceivedAt: row.payment_received_at ? String(row.payment_received_at) : null,
    }))
    .sort((a, b) => activitySortTime(b) - activitySortTime(a));

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
