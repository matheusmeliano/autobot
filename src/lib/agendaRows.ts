import { zonedDateTimeToUtcIso } from "@/lib/timezone";

type TemplateChoice = {
  id: string;
  nome?: string | null;
};

type DebtorRow = {
  id: string;
  nome?: string | null;
  vencimento?: string | null;
  debtor_charges?:
    | Array<{
        id?: string | null;
        due_day?: number | null;
        recurrence_month?: number | null;
        recurrence_year?: number | null;
        created_at?: string | null;
      }>
    | null;
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
  charge?: {
    due_day?: number | null;
    recurrence_month?: number | null;
    recurrence_year?: number | null;
  } | null;
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
  operational_due_at: string | null;
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

function lastDayOfMonth(year: number, month1: number) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function buildChargeLocalDate(params: {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}) {
  const year = Number(params.year ?? 0);
  const month = Number(params.month ?? 0);
  const day = Number(params.day ?? 0);
  if (!Number.isInteger(year) || year < 2000) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1) return null;
  const safeDay = Math.max(1, Math.min(day, lastDayOfMonth(year, month)));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function extractLocalTimeFromIso(value: string | null | undefined, timeZone: string) {
  const iso = String(value ?? "").trim();
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type === "literal") continue;
    map[part.type] = part.value;
  }
  return map.hour && map.minute ? `${map.hour}:${map.minute}` : null;
}

function extractLocalDateFromIso(value: string | null | undefined, timeZone: string) {
  const iso = String(value ?? "").trim();
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type === "literal") continue;
    map[part.type] = part.value;
  }
  return map.year && map.month && map.day ? `${map.year}-${map.month}-${map.day}` : null;
}

function compareChargeCandidateOrder(
  a: { recurrence_year?: number | null; recurrence_month?: number | null; due_day?: number | null; created_at?: string | null },
  b: { recurrence_year?: number | null; recurrence_month?: number | null; due_day?: number | null; created_at?: string | null },
) {
  const yearA = Number(a.recurrence_year ?? 0);
  const yearB = Number(b.recurrence_year ?? 0);
  if (yearA !== yearB) return yearA - yearB;
  const monthA = Number(a.recurrence_month ?? 0);
  const monthB = Number(b.recurrence_month ?? 0);
  if (monthA !== monthB) return monthA - monthB;
  const dayA = Number(a.due_day ?? 0);
  const dayB = Number(b.due_day ?? 0);
  if (dayA !== dayB) return dayA - dayB;
  return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
}

function resolveOperationalLocalDate(params: {
  debtor: DebtorRow | undefined;
  schedule: ScheduleSourceRow;
  timeZone: string;
  fallbackLocalDate: string | null;
}) {
  const charges = Array.isArray(params.debtor?.debtor_charges) ? params.debtor.debtor_charges : [];
  const scheduleChargeId = String(params.schedule.charge_id ?? "").trim();
  const recurrenceDay = Number(params.schedule.recurrence_day ?? 0);
  const referenceLocalDate = extractLocalDateFromIso(
    params.schedule.charge_due_at ?? params.schedule.data_envio ?? null,
    params.timeZone,
  );
  const referenceMonthKey = referenceLocalDate ? referenceLocalDate.slice(0, 7) : "";
  const referenceDay = referenceLocalDate ? Number(referenceLocalDate.slice(-2)) : 0;

  const scoredCharges = charges
    .map((charge) => {
      const localDate = buildChargeLocalDate({
        year: charge?.recurrence_year,
        month: charge?.recurrence_month,
        day: charge?.due_day,
      });
      if (!localDate) return null;
      let score = 0;
      const chargeId = String(charge?.id ?? "").trim();
      const chargeDay = Number(charge?.due_day ?? 0);
      const chargeMonthKey = localDate.slice(0, 7);
      if (referenceMonthKey && chargeMonthKey === referenceMonthKey) score += 100;
      if (recurrenceDay >= 1 && chargeDay === recurrenceDay) score += 60;
      if (referenceDay >= 1 && chargeDay === referenceDay) score += 40;
      if (params.fallbackLocalDate && localDate === params.fallbackLocalDate) score += 20;
      if (scheduleChargeId && chargeId === scheduleChargeId) score += 10;
      return {
        charge,
        localDate,
        score,
      };
    })
    .filter(Boolean) as Array<{
    charge: NonNullable<NonNullable<DebtorRow["debtor_charges"]>[number]>;
    localDate: string;
    score: number;
  }>;

  scoredCharges.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return compareChargeCandidateOrder(left.charge, right.charge);
  });

  if (scoredCharges[0]?.score > 0) {
    return scoredCharges[0].localDate;
  }

  return params.fallbackLocalDate;
}

export function buildAgendaRows(params: {
  debtors: DebtorRow[];
  schedules: ScheduleSourceRow[];
  latestExecutedRunBySchedule: Map<string, string>;
  templates?: TemplateChoice[];
  defaultTimeZone?: string | null;
}) {
  const debtorsById = new Map<string, DebtorRow>();
  for (const debtor of params.debtors ?? []) {
    const debtorId = String(debtor.id ?? "");
    if (!debtorId) continue;
    debtorsById.set(debtorId, debtor);
  }

  const templatesById = new Map<string, TemplateChoice>();
  for (const template of params.templates ?? []) {
    const templateId = String((template as any)?.id ?? "");
    if (!templateId) continue;
    templatesById.set(templateId, template as TemplateChoice);
  }

  const rows: AgendaRow[] = [];
  for (const schedule of params.schedules ?? []) {
    if (String(schedule.closed_at ?? "").trim()) continue;
    const scheduleId = String(schedule.id ?? "");
    const debtorId = String(schedule.debtor_id ?? "");
    if (!scheduleId || !debtorId) continue;

    const debtor = debtorsById.get(debtorId);
    const pendingTemplateId = String(schedule.template_pending_id ?? schedule.template_id ?? "").trim();
    const overdueTemplateId = String(schedule.template_overdue_id ?? "").trim();
    const pendingTemplateName =
      String(schedule.pending_template?.nome ?? "").trim() ||
      String(templatesById.get(pendingTemplateId)?.nome ?? "").trim() ||
      null;
    const overdueTemplateName =
      String(schedule.overdue_template?.nome ?? "").trim() ||
      String(templatesById.get(overdueTemplateId)?.nome ?? "").trim() ||
      null;
    const scheduleTimeZone = schedule.schedule_timezone ? String(schedule.schedule_timezone) : params.defaultTimeZone || null;
    const fallbackOperationalLocalDate = buildChargeLocalDate({
      year: schedule.charge?.recurrence_year,
      month: schedule.charge?.recurrence_month,
      day: schedule.charge?.due_day ?? schedule.recurrence_day,
    });
    const operationalLocalDate = resolveOperationalLocalDate({
      debtor,
      schedule,
      timeZone: scheduleTimeZone || "America/Sao_Paulo",
      fallbackLocalDate: fallbackOperationalLocalDate,
    });
    const operationalTime =
      (String(schedule.recurrence_time ?? "").trim() || extractLocalTimeFromIso(schedule.charge_due_at ?? schedule.data_envio ?? null, scheduleTimeZone || "America/Sao_Paulo")) ??
      "09:00";
    const operationalDueAt =
      operationalLocalDate && scheduleTimeZone
        ? zonedDateTimeToUtcIso({
            date: operationalLocalDate,
            time: operationalTime,
            timeZone: scheduleTimeZone,
          })
        : null;

    rows.push({
      id: scheduleId,
      debtor_id: debtorId,
      charge_id: schedule.charge_id ? String(schedule.charge_id) : null,
      source_kind: "schedule",
      schedule_missing: false,
      template_id: schedule.template_id ? String(schedule.template_id) : null,
      template_pending_id: pendingTemplateId || null,
      template_overdue_id: overdueTemplateId || null,
      data_envio: String(schedule.data_envio ?? schedule.charge_due_at ?? schedule.created_at ?? ""),
      charge_due_at: schedule.charge_due_at ? String(schedule.charge_due_at) : null,
      operational_due_at: operationalDueAt,
      next_charge_due_at: null,
      status: String(schedule.status ?? "agendado"),
      recurrence: schedule.recurrence ? String(schedule.recurrence) : "none",
      recurrence_until: schedule.recurrence_until ? String(schedule.recurrence_until) : null,
      recurrence_day: Number.isFinite(Number(schedule.recurrence_day)) ? Number(schedule.recurrence_day) : null,
      recurrence_time: schedule.recurrence_time ? String(schedule.recurrence_time) : null,
      schedule_timezone: scheduleTimeZone,
      last_sent_at: schedule.last_sent_at ? String(schedule.last_sent_at) : null,
      payment_received_at: schedule.payment_received_at ? String(schedule.payment_received_at) : null,
      last_executed_scheduled_for: params.latestExecutedRunBySchedule.get(scheduleId) ?? null,
      created_at: String(schedule.created_at ?? schedule.data_envio ?? ""),
      debtor_nome: String(debtor?.nome ?? "-"),
      template_nome: pendingTemplateName,
      template_pending_nome: pendingTemplateName,
      template_overdue_nome: overdueTemplateName,
    });
  }

  const onlyRealSchedules = rows.filter(
    (row) =>
      String(row.source_kind ?? "schedule") === "schedule" &&
      !Boolean(row.schedule_missing) &&
      !String(row.id ?? "").startsWith("charge:"),
  );
  return onlyRealSchedules.sort((a, b) => {
    const debtorCompare = String(a.debtor_nome ?? "").localeCompare(String(b.debtor_nome ?? ""), "pt-BR", {
      sensitivity: "base",
    });
    if (debtorCompare !== 0) return debtorCompare;
    return String(a.operational_due_at ?? a.charge_due_at ?? a.data_envio).localeCompare(
      String(b.operational_due_at ?? b.charge_due_at ?? b.data_envio),
    );
  });
}
