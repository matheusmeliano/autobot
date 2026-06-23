import { resolveAutoChargeTemplates, type ChargeTemplateChoice } from "@/lib/chargeTemplates";
import { zonedDateTimeToUtcIso } from "@/lib/timezone";

type DebtorChargeRow = {
  id: string;
  due_day: number;
  recurrence_month: number;
  recurrence_year: number;
  created_at?: string | null;
};

type TemplateChoice = ChargeTemplateChoice;

type DebtorRow = {
  id: string;
  nome?: string | null;
  observacoes?: string | null;
  retry_time?: string | null;
  debtor_charges?: DebtorChargeRow[] | null;
};

type ScheduleSourceRow = {
  id: string;
  debtor_id: string;
  charge_id?: string | null;
  template_id?: string | null;
  template_pending_id?: string | null;
  template_overdue_id?: string | null;
  data_envio?: string | null;
  charge_due_at?: string | null;
  status?: string | null;
  recurrence?: string | null;
  recurrence_until?: string | null;
  recurrence_day?: number | null;
  recurrence_time?: string | null;
  schedule_timezone?: string | null;
  last_sent_at?: string | null;
  payment_received_at?: string | null;
  created_at?: string | null;
  closed_at?: string | null;
  pending_template?: { nome?: string | null } | null;
  overdue_template?: { nome?: string | null } | null;
};

type AgendaRow = {
  id: string;
  debtor_id: string;
  charge_id: string | null;
  source_kind: "charge" | "schedule";
  schedule_missing: boolean;
  template_id: string | null;
  template_pending_id: string | null;
  template_overdue_id: string | null;
  data_envio: string;
  charge_due_at: string | null;
  next_charge_due_at: string | null;
  status: string;
  recurrence: string | null;
  recurrence_until: string | null;
  recurrence_day: number | null;
  recurrence_time: string | null;
  schedule_timezone: string | null;
  last_sent_at: string | null;
  payment_received_at: string | null;
  last_executed_scheduled_for: string | null;
  created_at: string;
  debtor_nome: string;
  template_nome: string | null;
  template_pending_nome: string | null;
  template_overdue_nome: string | null;
};

function compareChargeOrder(a: DebtorChargeRow, b: DebtorChargeRow) {
  if (a.recurrence_year !== b.recurrence_year) return a.recurrence_year - b.recurrence_year;
  if (a.recurrence_month !== b.recurrence_month) return a.recurrence_month - b.recurrence_month;
  if (a.due_day !== b.due_day) return a.due_day - b.due_day;
  return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
}

function buildChargeIso(charge: DebtorChargeRow, time: string, timeZone: string) {
  const safeDay = String(Math.max(1, Math.min(Number(charge.due_day) || 1, 31))).padStart(2, "0");
  const date = `${String(charge.recurrence_year).padStart(4, "0")}-${String(charge.recurrence_month).padStart(2, "0")}-${safeDay}`;
  return zonedDateTimeToUtcIso({ date, time, timeZone });
}

function fallbackScheduleMatch(
  schedules: ScheduleSourceRow[],
  charge: DebtorChargeRow,
  usedScheduleIds: Set<string>,
) {
  return (
    schedules.find((schedule) => {
      const scheduleId = String(schedule.id ?? "");
      if (!scheduleId || usedScheduleIds.has(scheduleId)) return false;
      return Number(schedule.recurrence_day ?? 0) === Number(charge.due_day ?? 0);
    }) ?? null
  );
}

export function buildAgendaRows(params: {
  debtors: DebtorRow[];
  schedules: ScheduleSourceRow[];
  latestExecutedRunBySchedule: Map<string, string>;
  templates?: TemplateChoice[];
}) {
  const scheduleGroups = new Map<string, ScheduleSourceRow[]>();
  for (const schedule of params.schedules ?? []) {
    if (String(schedule.closed_at ?? "").trim()) continue;
    const debtorId = String(schedule.debtor_id ?? "");
    if (!debtorId) continue;
    const list = scheduleGroups.get(debtorId) ?? [];
    list.push(schedule);
    scheduleGroups.set(debtorId, list);
  }

  const rows: AgendaRow[] = [];
  for (const debtor of params.debtors ?? []) {
    const debtorId = String(debtor.id ?? "");
    if (!debtorId) continue;
    const timeZone = "America/Sao_Paulo";
    const retryTime = String(debtor.retry_time ?? "").trim() || "09:00";
    const charges = [...((debtor.debtor_charges ?? []) as DebtorChargeRow[])]
      .filter((charge) => String(charge?.id ?? ""))
      .sort(compareChargeOrder);
    if (!charges.length) continue;

    const availableSchedules = scheduleGroups.get(debtorId) ?? [];
    const usedScheduleIds = new Set<string>();
    const templateDefaults = resolveAutoChargeTemplates(
      params.templates ?? [],
      String(debtor.observacoes ?? debtor.nome ?? ""),
    );

    for (const [index, charge] of charges.entries()) {
      const chargeId = String(charge.id ?? "");
      const exactMatch =
        availableSchedules.find((schedule) => {
          const scheduleId = String(schedule.id ?? "");
          if (!scheduleId || usedScheduleIds.has(scheduleId)) return false;
          return String(schedule.charge_id ?? "") === chargeId;
        }) ?? null;
      const matchedSchedule = exactMatch ?? fallbackScheduleMatch(availableSchedules, charge, usedScheduleIds);
      const matchedScheduleId = String(matchedSchedule?.id ?? "");
      if (matchedScheduleId) usedScheduleIds.add(matchedScheduleId);

      const chargeDueAt = buildChargeIso(charge, retryTime, timeZone);
      const dataEnvio = matchedSchedule?.data_envio ?? chargeDueAt;
      const nextCharge = charges[index + 1] ?? null;
      const nextChargeDueAt = nextCharge ? buildChargeIso(nextCharge, retryTime, timeZone) : null;

      rows.push({
        id: matchedSchedule?.id ? String(matchedSchedule.id) : `charge:${chargeId}`,
        debtor_id: debtorId,
        charge_id: chargeId,
        source_kind: "charge",
        schedule_missing: !matchedSchedule?.id,
        template_id: matchedSchedule?.template_id
          ? String(matchedSchedule.template_id)
          : templateDefaults.pendingId,
        template_pending_id: matchedSchedule?.template_pending_id
          ? String(matchedSchedule.template_pending_id)
          : templateDefaults.pendingId,
        template_overdue_id: matchedSchedule?.template_overdue_id
          ? String(matchedSchedule.template_overdue_id)
          : templateDefaults.overdueId,
        data_envio: String(dataEnvio),
        charge_due_at: String(chargeDueAt),
        next_charge_due_at: nextChargeDueAt,
        status: String(matchedSchedule?.status ?? "agendado"),
        recurrence: matchedSchedule?.recurrence ? String(matchedSchedule.recurrence) : "none",
        recurrence_until: matchedSchedule?.recurrence_until ? String(matchedSchedule.recurrence_until) : null,
        recurrence_day: Number.isFinite(Number(charge.due_day)) ? Number(charge.due_day) : null,
        recurrence_time: matchedSchedule?.recurrence_time ? String(matchedSchedule.recurrence_time) : retryTime,
        schedule_timezone: matchedSchedule?.schedule_timezone ? String(matchedSchedule.schedule_timezone) : timeZone,
        last_sent_at: matchedSchedule?.last_sent_at ? String(matchedSchedule.last_sent_at) : null,
        payment_received_at: matchedSchedule?.payment_received_at ? String(matchedSchedule.payment_received_at) : null,
        last_executed_scheduled_for: matchedSchedule?.id
          ? params.latestExecutedRunBySchedule.get(String(matchedSchedule.id)) ?? null
          : null,
        created_at: String(matchedSchedule?.created_at ?? charge.created_at ?? chargeDueAt),
        debtor_nome: String(debtor.nome ?? "-"),
        template_nome: matchedSchedule?.pending_template?.nome
          ? String(matchedSchedule.pending_template.nome)
          : templateDefaults.pendingNome,
        template_pending_nome: matchedSchedule?.pending_template?.nome
          ? String(matchedSchedule.pending_template.nome)
          : templateDefaults.pendingNome,
        template_overdue_nome: matchedSchedule?.overdue_template?.nome
          ? String(matchedSchedule.overdue_template.nome)
          : templateDefaults.overdueNome,
      });
    }

  }

  return rows.sort((a, b) => {
    const debtorCompare = String(a.debtor_nome ?? "").localeCompare(String(b.debtor_nome ?? ""), "pt-BR", {
      sensitivity: "base",
    });
    if (debtorCompare !== 0) return debtorCompare;
    return String(a.charge_due_at ?? a.data_envio).localeCompare(String(b.charge_due_at ?? b.data_envio));
  });
}
