const DEBTORS_PAGE_SIZE = 200;
const SCHEDULES_PAGE_SIZE = 1000;
const SCHEDULE_RUNS_PAGE_SIZE = 1000;

const DEBTORS_SELECT =
  "id, nome, telefone, valor, vencimento, pix_key, observacoes, status, accumulate_open_monthly_charges, skip_weekends_on_first_charge, retry_weekdays, retry_time, retry_max_attempts, retry_interval_days, retry_auto_close_days, created_at, debtor_charges(id, amount, due_day, recurrence_month, recurrence_year, created_at)";

const SCHEDULES_SELECT =
  "id, debtor_id, charge_id, status, recurrence, data_envio, charge_due_at, first_sent_at, last_sent_at, payment_received_at, schedule_timezone, closed_at";

type ClientesQueryResult<T> = {
  data: T[] | null;
  error: { message?: string | null } | null;
};

export async function listAllClientesDebtors(supabase: any): Promise<ClientesQueryResult<any>> {
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("debtors")
      .select(DEBTORS_SELECT)
      .order("created_at", { ascending: false })
      .range(offset, offset + DEBTORS_PAGE_SIZE - 1);

    if (error) return { data: null, error };

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < DEBTORS_PAGE_SIZE) break;
    offset += DEBTORS_PAGE_SIZE;
  }

  return { data: rows, error: null };
}

export async function listAllClientesSchedules(supabase: any): Promise<ClientesQueryResult<any>> {
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("schedules")
      .select(SCHEDULES_SELECT)
      .order("created_at", { ascending: true })
      .range(offset, offset + SCHEDULES_PAGE_SIZE - 1);

    if (error) return { data: null, error };

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < SCHEDULES_PAGE_SIZE) break;
    offset += SCHEDULES_PAGE_SIZE;
  }

  return { data: rows, error: null };
}

export async function listAllClientesScheduleRuns(supabase: any): Promise<ClientesQueryResult<any>> {
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("schedule_runs")
      .select("schedule_id, scheduled_for")
      .eq("status", "executado")
      .order("scheduled_for", { ascending: false })
      .range(offset, offset + SCHEDULE_RUNS_PAGE_SIZE - 1);

    if (error) return { data: null, error };

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < SCHEDULE_RUNS_PAGE_SIZE) break;
    offset += SCHEDULE_RUNS_PAGE_SIZE;
  }

  return { data: rows, error: null };
}
