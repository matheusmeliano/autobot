import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/app/DashboardClient";
import { localDateInTimeZone } from "@/lib/recurrence";
import { buildAgendaRows } from "@/lib/agendaRows";
import { deriveAgendarVisualStatus } from "@/lib/agendarStatus";
import { getOpenMonthlyInstallments } from "@/lib/chargeAccumulation";
import {
  deriveReferenceMonthDebtorStatus,
  deriveReferenceMonthDebtorChargeProgress,
} from "@/lib/debtorChargeStatus";
import { BRAZIL_TIMEZONES, type BrazilTimeZone } from "@/lib/timezone";
import {
  areBrazilianPhonesEquivalent,
  loadHiddenWhatsAppPhoneBlocklist,
  normalizePhoneDigitsOnly,
} from "@/lib/painelHiddenPhones";
import { getZapiInstanceMeta, refreshOneWhatsAppInstanceStatusLive } from "@/lib/atendimento/server";

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
    scheduleRunsRes,
    debtorsRes,
    schedulesRes,
    hiddenBlocklistRaw,
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
    supabase
      .from("schedule_runs")
      .select("schedule_id, scheduled_for")
      .eq("status", "executado")
      .order("scheduled_for", { ascending: false })
      .limit(2000),
    supabase
      .from("debtors")
      .select(
        "id, nome, telefone, observacoes, valor, status, retry_time, accumulate_open_monthly_charges, debtor_charges(id, amount, due_day, recurrence_month, recurrence_year, created_at)",
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
    loadHiddenWhatsAppPhoneBlocklist(),
  ]);
  const liveWhatsappStatus = await dashboardRefreshWhatsAppStatusLive(supabase, whatsappRes.data);

  const hiddenBlocklist = (hiddenBlocklistRaw ?? new Set<string>()) as Set<string>;
  const debtorTelefoneById = new Map<string, string>();
  for (const d of (debtorsRes.data ?? []) as any[]) {
    const id = String(d?.id ?? "");
    if (!id) continue;
    debtorTelefoneById.set(id, String(d?.telefone ?? ""));
  }

  function debtorPhoneIsBlocked(phoneRaw: any): boolean {
    const phone = normalizePhoneDigitsOnly(String(phoneRaw ?? ""));
    if (!phone) return false;
    for (const blocked of hiddenBlocklist) {
      if (!blocked) continue;
      if (areBrazilianPhonesEquivalent(phone, blocked)) return true;
    }
    return false;
  }

  const debtorsFiltered = ((debtorsRes.data ?? []) as any[]).filter(
    (d) => !debtorPhoneIsBlocked(String(d?.telefone ?? "")),
  );
  const schedulesFiltered = ((schedulesRes.data ?? []) as any[]).filter((s) => {
    const debtorId = String((s as any)?.debtor_id ?? "");
    if (!debtorId) return true;
    const phone = debtorTelefoneById.get(debtorId) ?? "";
    if (!debtorPhoneIsBlocked(phone)) return true;
    return false;
  });

  const schedules = schedulesFiltered as any[];
  const schedulesWithLatestRun = schedules.map((s) => ({
    ...s,
    last_executed_scheduled_for:
      latestExecutedRunBySchedule.get(String((s as any).id ?? "")) ?? null,
  }));
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

  const debtorStatuses = new Map<string, string>();
  {
    const schedulesByDebtor = new Map<string, any[]>();
    for (const schedule of schedulesWithLatestRun) {
      const debtorId = String(schedule?.debtor_id ?? "");
      if (!debtorId) continue;
      const list = schedulesByDebtor.get(debtorId) ?? [];
      list.push(schedule);
      schedulesByDebtor.set(debtorId, list);
    }
    for (const debtor of debtorsFiltered as any[]) {
      const debtorId = String(debtor?.id ?? "");
      if (!debtorId) continue;
      const charges = Array.isArray(debtor?.debtor_charges) ? (debtor.debtor_charges as any[]) : [];
      const debtorSchedules = schedulesByDebtor.get(debtorId) ?? [];
      if (!debtorSchedules.length) {
        const raw = String(debtor?.status ?? "").trim().toLowerCase();
        debtorStatuses.set(debtorId, raw || "-");
        continue;
      }
      const openSchedules = debtorSchedules.filter((row) => !String(row.closed_at ?? "").trim());
      const derived = deriveReferenceMonthDebtorStatus(charges, debtorSchedules, now.toISOString());
      const next = !openSchedules.length && derived !== "pago" ? "-" : derived;
      debtorStatuses.set(debtorId, next);
    }
  }

  {
    const schedulesByDebtor = new Map<string, any[]>();
    for (const schedule of schedulesWithLatestRun) {
      const debtorId = String(schedule?.debtor_id ?? "");
      if (!debtorId) continue;
      const list = schedulesByDebtor.get(debtorId) ?? [];
      list.push(schedule);
      schedulesByDebtor.set(debtorId, list);
    }

    for (const debtor of debtorsFiltered as any[]) {
      const debtorId = String(debtor?.id ?? "");
      if (!debtorId) continue;
      const baseAmountRaw = debtor?.valor;
      const baseAmount =
        typeof baseAmountRaw === "number" && !Number.isNaN(baseAmountRaw) ? baseAmountRaw : null;
      if (baseAmount == null || baseAmount <= 0) continue;
      const accumulate = Boolean(debtor?.accumulate_open_monthly_charges);
      const debtorStatus = String(debtorStatuses.get(debtorId) ?? "").trim().toLowerCase();

      const debtorSchedules = schedulesByDebtor.get(debtorId) ?? [];
      const charges = Array.isArray(debtor?.debtor_charges) ? (debtor.debtor_charges as any[]) : [];
      const progress = deriveReferenceMonthDebtorChargeProgress(
        charges,
        debtorSchedules,
        now.toISOString(),
      );

      if (progress.total > 0) {
        const chargeMultiplier = Math.max(1, progress.total);
        const monthTotal = baseAmount * chargeMultiplier;
        const paidCount = Math.min(progress.total, progress.paid);
        const monthPaid = baseAmount * paidCount;
        receivableMonthTotal += monthTotal;
        receivableMonthPaid += monthPaid;
        continue;
      }

      const scheduleRef = debtorSchedules.find((s) => {
        const tz = String(s?.schedule_timezone ?? "") || effectiveTimeZone;
        const ref =
          scheduleLocalMonthKey(s?.charge_due_at, tz) ??
          scheduleLocalMonthKey(s?.data_envio, tz) ??
          scheduleLocalMonthKey(s?.last_executed_scheduled_for, tz);
        return ref === currentMonthKey;
      }) ?? debtorSchedules[0];

      const scheduleTimeZone = String(scheduleRef?.schedule_timezone ?? "") || effectiveTimeZone;
      const recurrence = String(scheduleRef?.recurrence ?? "monthly").trim().toLowerCase();
      const status = String(scheduleRef?.status ?? "").trim().toLowerCase();
      const closedAt = scheduleRef?.closed_at ?? null;
      const chargeDueAt = scheduleRef?.charge_due_at ?? null;
      const dataEnvio = scheduleRef?.data_envio ?? null;

      let chargeMultiplier = 1;
      if (accumulate && recurrence === "monthly") {
        const closed = Boolean(String(closedAt ?? "").trim());
        if (!closed && status !== "pago") {
          chargeMultiplier = getOpenMonthlyInstallments({
            chargeDueAt,
            dataEnvio,
            nowUtcIso: now.toISOString(),
            timeZone: scheduleTimeZone,
          });
        }
      }

      const monthTotal = baseAmount * chargeMultiplier;
      const isPaid =
        debtorStatus === "pago" ||
        Boolean(
          debtorSchedules.some((s: any) => {
            const tz = String(s?.schedule_timezone ?? "") || effectiveTimeZone;
            const statusNorm = String(s?.status ?? "").trim().toLowerCase();
            if (statusNorm === "pago") return true;
            const paymentMoment = String(s?.payment_received_at ?? "").trim();
            if (!paymentMoment) return false;
            const pmKey = scheduleLocalMonthKey(paymentMoment, tz);
            if (pmKey === currentMonthKey) return true;
            const closedMoment = String(s?.closed_at ?? "").trim();
            if (closedMoment) {
              const closedKey = scheduleLocalMonthKey(closedMoment, tz);
              if (closedKey === currentMonthKey) return true;
            }
            return false;
          }),
        );
      receivableMonthTotal += monthTotal;
      if (isPaid) {
        receivableMonthPaid += monthTotal;
      }
    }
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
