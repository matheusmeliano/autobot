const AGENDAR_SCHEDULES_PAGE_SIZE = 500;
const AGENDAR_SCHEDULE_RUNS_PAGE_SIZE = 1000;
const AGENDAR_DEBTORS_PAGE_SIZE = 200;
const AGENDAR_TEMPLATES_PAGE_SIZE = 200;

const AGENDAR_SCHEDULES_SELECT =
  "id, debtor_id, charge_id, template_id, template_pending_id, template_overdue_id, data_envio, charge_due_at, status, recurrence, recurrence_until, recurrence_day, recurrence_time, schedule_timezone, last_sent_at, payment_received_at, created_at, closed_at, charge:debtor_charges!schedules_charge_id_fkey(due_day, recurrence_month, recurrence_year), pending_template:message_templates!schedules_template_pending_id_fkey(nome), overdue_template:message_templates!schedules_template_overdue_id_fkey(nome)";

const AGENDAR_DEBTORS_SELECT =
  "id, nome, observacoes, retry_weekdays, retry_time, retry_max_attempts, retry_interval_days, retry_auto_close_days, debtor_charges(id, due_day, recurrence_month, recurrence_year, created_at)";

type AgendarQueryResult<T> = {
  data: T[] | null;
  error: { message?: string | null } | null;
};

export async function listAllAgendarSchedules(supabase: any): Promise<AgendarQueryResult<any>> {
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("schedules")
      .select(AGENDAR_SCHEDULES_SELECT)
      .order("data_envio", { ascending: true })
      .range(offset, offset + AGENDAR_SCHEDULES_PAGE_SIZE - 1);

    if (error) return { data: null, error };

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < AGENDAR_SCHEDULES_PAGE_SIZE) break;
    offset += AGENDAR_SCHEDULES_PAGE_SIZE;
  }

  return { data: rows, error: null };
}

export async function listAllAgendarScheduleRuns(supabase: any): Promise<AgendarQueryResult<any>> {
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("schedule_runs")
      .select("schedule_id, scheduled_for")
      .eq("status", "executado")
      .order("scheduled_for", { ascending: false })
      .range(offset, offset + AGENDAR_SCHEDULE_RUNS_PAGE_SIZE - 1);

    if (error) return { data: null, error };

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < AGENDAR_SCHEDULE_RUNS_PAGE_SIZE) break;
    offset += AGENDAR_SCHEDULE_RUNS_PAGE_SIZE;
  }

  return { data: rows, error: null };
}

export async function listAllAgendarDebtors(supabase: any): Promise<AgendarQueryResult<any>> {
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("debtors")
      .select(AGENDAR_DEBTORS_SELECT)
      .order("nome", { ascending: true })
      .range(offset, offset + AGENDAR_DEBTORS_PAGE_SIZE - 1);

    if (error) return { data: null, error };

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < AGENDAR_DEBTORS_PAGE_SIZE) break;
    offset += AGENDAR_DEBTORS_PAGE_SIZE;
  }

  return { data: rows, error: null };
}

export async function listAllAgendarTemplates(supabase: any): Promise<AgendarQueryResult<any>> {
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("message_templates")
      .select("id, nome, created_at")
      .order("created_at", { ascending: true })
      .range(offset, offset + AGENDAR_TEMPLATES_PAGE_SIZE - 1);

    if (error) return { data: null, error };

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < AGENDAR_TEMPLATES_PAGE_SIZE) break;
    offset += AGENDAR_TEMPLATES_PAGE_SIZE;
  }

  return { data: rows, error: null };
}
