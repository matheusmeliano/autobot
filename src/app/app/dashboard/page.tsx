import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/app/DashboardClient";
import { localDateInTimeZone } from "@/lib/recurrence";
import { buildAgendaRows } from "@/lib/agendaRows";
import { deriveAgendarVisualStatus } from "@/lib/agendarStatus";
import { getOpenMonthlyInstallments } from "@/lib/chargeAccumulation";
import {
  applyCurrentMonthDebtorStatuses,
  deriveReferenceMonthDebtorStatus,
  deriveReferenceMonthDebtorChargeProgress,
} from "@/lib/debtorChargeStatus";
import { BRAZIL_TIMEZONES, type BrazilTimeZone } from "@/lib/timezone";
import { refreshOneWhatsAppInstanceStatusLive } from "@/lib/atendimento/server";
import {
  listAllClientesDebtors,
  listAllClientesScheduleRuns,
  listAllClientesSchedules,
} from "@/lib/clientesData";

async function dashboardRefreshWhatsAppStatusLive(
  supabase: any,
  whatsappRow: any,
): Promise<string | null> {
  return await refreshOneWhatsAppInstanceStatusLive({
    supabase,
    row: {
      user_id: null,
      instance_id: String(whatsappRow?.instance_id ?? "").trim() || null,
      token: String(whatsappRow?.token ?? "").trim() || null,
      client_token: (whatsappRow?.client_token
        ? String(whatsappRow.client_token).trim()
        : undefined) || undefined,
      status: String(whatsappRow?.status ?? "").trim() || null,
    },
    filterMode: "by_instance_id",
    stickyConnected: false,
  });
}

function scheduleLocalMonthKey(value: string | null | undefined, timeZone: string) {
  const iso = String(value ?? "").trim();
  if (!iso) return null;
  try {
    return localDateInTimeZone(iso, timeZone).slice(0, 7);
  } catch {
    return null;
  }
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
  const chargeMonthKey = chargeDueAt ? scheduleLocalMonthKey(chargeDueAt, timeZone) : null;
  if (chargeMonthKey === currentMonthKey) {
    const time = new Date(chargeDueAt).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
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
  const chargeMonthKey = chargeDueAt ? scheduleLocalMonthKey(chargeDueAt, timeZone) : null;
  if (chargeMonthKey === currentMonthKey) return 0;
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
        hasCurrentMonthSchedules={false}
        timeZone={null}
      />
    );
  }

  const now = new Date();

  const [
    templatesRes,
    whatsappRes,
    profileRes,
    debtorsRes,
    schedulesRes,
    scheduleRunsRes,
  ] = await Promise.all([
    supabase
      .from("message_templates")
      .select("id, nome, created_at")
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("whatsapp_instances")
      .select("instance_id, token, client_token, status")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("profiles").select("nome, timezone").eq("user_id", userId).maybeSingle(),
    listAllClientesDebtors(supabase),
    listAllClientesSchedules(supabase),
    listAllClientesScheduleRuns(supabase),
  ]);
  const liveWhatsappStatus = await dashboardRefreshWhatsAppStatusLive(supabase, whatsappRes.data);
  const debtorsFiltered = (debtorsRes.data ?? []) as any[];
  const schedules = (schedulesRes.data ?? []) as any[];
  const latestExecutedRunBySchedule = new Map<string, string>();
  for (const run of scheduleRunsRes.data ?? []) {
    const scheduleId = String((run as any)?.schedule_id ?? "");
    const scheduledFor = String((run as any)?.scheduled_for ?? "");
    if (!scheduleId || !scheduledFor || latestExecutedRunBySchedule.has(scheduleId)) continue;
    latestExecutedRunBySchedule.set(scheduleId, scheduledFor);
  }
  const schedulesWithLatestRun = schedules.map((s) => ({
    ...s,
    last_executed_scheduled_for:
      latestExecutedRunBySchedule.get(String((s as any).id ?? "")) ?? null,
  }));
  const debtorsWithStatus = applyCurrentMonthDebtorStatuses({
    debtors: (debtorsFiltered as any[]).map((row) => ({
      ...row,
      status: row.status ?? "ativo",
      charges: ((row as any)?.debtor_charges ?? []).map((c: any) => ({
        ...c,
        amount: typeof c?.amount === "number" ? c.amount : Number(c?.amount),
        due_day: typeof c?.due_day === "number" ? c.due_day : Number(c?.due_day),
        recurrence_month: typeof c?.recurrence_month === "number" ? c.recurrence_month : Number(c?.recurrence_month),
        recurrence_year: typeof c?.recurrence_year === "number" ? c.recurrence_year : Number(c?.recurrence_year),
      })),
    })),
    schedules: schedulesWithLatestRun as any[],
    nowUtcIso: now.toISOString(),
  });
  const tzRaw = (profileRes as any)?.data?.timezone;
  const timeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? (tzRaw as BrazilTimeZone) : null;
  const effectiveTimeZone: BrazilTimeZone = timeZone ?? "America/Sao_Paulo";
  const currentMonthKey = localDateInTimeZone(now.toISOString(), effectiveTimeZone).slice(0, 7);
  const agendaRows = buildAgendaRows({
    debtors: debtorsFiltered as any[],
    schedules,
    latestExecutedRunBySchedule,
    templates: (templatesRes.data ?? []) as any[],
    defaultTimeZone: timeZone,
  });
  const schedulesById = new Map<string, any>();
  for (const schedule of schedules) {
    const scheduleId = String((schedule as any)?.id ?? "");
    if (!scheduleId) continue;
    schedulesById.set(scheduleId, schedule);
  }
  const agendaRowsWithVisualStatus = agendaRows.map((row) => ({
    row,
    visualStatus: deriveAgendarVisualStatus(row, effectiveTimeZone, currentMonthKey),
  }));
  const currentMonthAgendaRows = agendaRowsWithVisualStatus.filter(
    ({ visualStatus }) => visualStatus.isCurrentMonth,
  );
  const hasCurrentMonthSchedules = currentMonthAgendaRows.length > 0;

  let receivableMonthTotal = 0;
  let receivableMonthPaid = 0;
  const schedulesByDebtor = new Map<string, any[]>();
  for (const schedule of schedulesWithLatestRun) {
    const debtorId = String(schedule?.debtor_id ?? "");
    if (!debtorId) continue;
    const list = schedulesByDebtor.get(debtorId) ?? [];
    list.push(schedule);
    schedulesByDebtor.set(debtorId, list);
  }

  const nowUtcIso = now.toISOString();

  for (const debtor of debtorsWithStatus as any[]) {
    const debtorId = String(debtor?.id ?? "");
    if (!debtorId) continue;
    const baseAmountRaw = debtor?.valor;
    const baseAmount =
      typeof baseAmountRaw === "number" && !Number.isNaN(baseAmountRaw) ? baseAmountRaw : null;
    if (baseAmount == null || baseAmount <= 0) continue;

    const charges = Array.isArray(debtor?.debtor_charges) ? (debtor.debtor_charges as any[]) : [];
    const debtorSchedules = schedulesByDebtor.get(debtorId) ?? [];

    let chargeMultiplier = 1;
    if (Boolean(debtor?.accumulate_open_monthly_charges) && debtorSchedules.length) {
      let maxInstallments = 1;
      for (const s of debtorSchedules) {
        const recurrence = String(s?.recurrence ?? "").trim().toLowerCase();
        if (recurrence !== "monthly") continue;
        const closedAt = s?.closed_at ?? null;
        const status = String(s?.status ?? "").trim().toLowerCase();
        if (Boolean(String(closedAt ?? "").trim()) || status === "pago") continue;
        const scheduleTimeZone = String(s?.schedule_timezone ?? "") || effectiveTimeZone;
        const inst = getOpenMonthlyInstallments({
          chargeDueAt: s?.charge_due_at ?? null,
          dataEnvio: s?.data_envio ?? null,
          nowUtcIso,
          timeZone: scheduleTimeZone,
        });
        if (inst > maxInstallments) maxInstallments = inst;
      }
      chargeMultiplier = maxInstallments;
    } else if (charges.length) {
      const progress = deriveReferenceMonthDebtorChargeProgress(charges, debtorSchedules, nowUtcIso);
      if (progress.total > 0) chargeMultiplier = progress.total;
    }

    const monthTotal = baseAmount * chargeMultiplier;

    let paidMultiplier = 0;
    if (charges.length || debtorSchedules.length) {
      const progress = deriveReferenceMonthDebtorChargeProgress(charges, debtorSchedules, nowUtcIso);
      if (progress.total > 0) {
        paidMultiplier = Math.min(progress.total, progress.paid);
      } else {
        const derived = deriveReferenceMonthDebtorStatus(charges, debtorSchedules, nowUtcIso);
        if (derived === "pago") paidMultiplier = chargeMultiplier;
      }
    }

    const monthPaid = baseAmount * paidMultiplier;
    receivableMonthTotal += monthTotal;
    receivableMonthPaid += monthPaid;
  }

  const receivableMonthRemaining = Math.max(0, receivableMonthTotal - receivableMonthPaid);

  const stats = {
    clients: debtorsFiltered.length,
    templates: (templatesRes.data ?? []).length,
    activeSchedules: agendaRowsWithVisualStatus.filter(
      ({ visualStatus, row }) =>
        visualStatus.label === "Agendado" || String(row.status ?? "").trim().toLowerCase() === "executando",
    ).length,
    whatsappStatus: liveWhatsappStatus ?? whatsappRes.data?.status ?? "disconnected",
    receivableMonthTotal,
    receivableMonthPaid,
    receivableMonthRemaining,
  };

  const chartDates = hasCurrentMonthSchedules
    ? currentMonthAgendaRows.map(({ row }) => String(row.created_at ?? "")).filter(Boolean)
    : [];

  const activities = currentMonthAgendaRows
    .map(({ row }) => ({
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
      hasCurrentMonthSchedules={hasCurrentMonthSchedules}
      timeZone={timeZone}
    />
  );
}
