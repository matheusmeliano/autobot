type TemplateChoice = {
  id: string;
  nome?: string | null;
};

type DebtorRow = {
  id: string;
  nome?: string | null;
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
      operational_due_at: null,
      next_charge_due_at: null,
      status: String(schedule.status ?? "agendado"),
      recurrence: schedule.recurrence ? String(schedule.recurrence) : "none",
      recurrence_until: schedule.recurrence_until ? String(schedule.recurrence_until) : null,
      recurrence_day: Number.isFinite(Number(schedule.recurrence_day)) ? Number(schedule.recurrence_day) : null,
      recurrence_time: schedule.recurrence_time ? String(schedule.recurrence_time) : null,
      schedule_timezone: schedule.schedule_timezone ? String(schedule.schedule_timezone) : params.defaultTimeZone || null,
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

  return rows.sort((a, b) => {
    const debtorCompare = String(a.debtor_nome ?? "").localeCompare(String(b.debtor_nome ?? ""), "pt-BR", {
      sensitivity: "base",
    });
    if (debtorCompare !== 0) return debtorCompare;
    return String(a.charge_due_at ?? a.data_envio).localeCompare(String(b.charge_due_at ?? b.data_envio));
  });
}
