import {
  areBrazilianPhonesEquivalent,
  loadHiddenWhatsAppPhoneBlocklist,
  normalizePhoneDigitsOnly,
} from "./painelHiddenPhones";

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

async function loadHiddenBlocklistIfNeeded(params: {
  supabase: any;
  cached: Set<string> | null;
}): Promise<Set<string>> {
  if (params.cached) return params.cached;
  let set: Set<string> = new Set();
  try {
    if (params.supabase) {
      set = await loadHiddenWhatsAppPhoneBlocklist({ supabaseAdmin: params.supabase });
    } else {
      set = await loadHiddenWhatsAppPhoneBlocklist();
    }
  } catch (_e) {}
  return set;
}

function debtorIsBlocked(row: any, blocklist: Set<string>): boolean {
  const phone = String(row?.telefone ?? "");
  const pDigits = normalizePhoneDigitsOnly(phone);
  if (!pDigits) return false;
  for (const blocked of blocklist) {
    if (!blocked) continue;
    if (areBrazilianPhonesEquivalent(pDigits, blocked)) return true;
  }
  return false;
}

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

  const hiddenBlocklist = await loadHiddenBlocklistIfNeeded({ supabase, cached: null });
  const filtered = rows.filter((r) => !debtorIsBlocked(r, hiddenBlocklist));
  return { data: filtered, error: null };
}

export async function listAllClientesSchedules(
  supabase: any,
  options?: { hiddenBlocklist?: Set<string>; debtorTelefonesById?: Map<string, string> },
): Promise<ClientesQueryResult<any> & { hiddenBlocklist: Set<string>; debtorTelefonesById: Map<string, string> }> {
  let hiddenBlocklist = options?.hiddenBlocklist ?? null;
  let debtorTelefonesById = options?.debtorTelefonesById ?? null;

  if (!hiddenBlocklist || !debtorTelefonesById) {
    hiddenBlocklist = await loadHiddenBlocklistIfNeeded({ supabase, cached: hiddenBlocklist ?? null });
    try {
      const debtorIds: string[] = [];
      const telefones = new Map<string, string>();
      let off = 0;
      while (true) {
        const { data: debtorPage, error: dErr } = await supabase
          .from("debtors")
          .select("id, telefone")
          .range(off, off + 500 - 1);
        if (dErr) break;
        const arr = (debtorPage ?? []) as any[];
        for (const d of arr) {
          const id = String(d?.id ?? "");
          if (!id) continue;
          telefones.set(id, String(d?.telefone ?? ""));
        }
        if (arr.length < 500) break;
        off += 500;
      }
      debtorTelefonesById = telefones;
    } catch (_e) {
      debtorTelefonesById = new Map();
    }
  }

  const rows: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("schedules")
      .select(SCHEDULES_SELECT)
      .order("created_at", { ascending: true })
      .range(offset, offset + SCHEDULES_PAGE_SIZE - 1);

    if (error) return { data: null, error, hiddenBlocklist, debtorTelefonesById };

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < SCHEDULES_PAGE_SIZE) break;
    offset += SCHEDULES_PAGE_SIZE;
  }

  const filtered = rows.filter((s) => {
    const debtorId = String((s as any)?.debtor_id ?? "");
    if (!debtorId) return true;
    const phone = debtorTelefonesById?.get(debtorId) ?? "";
    const pDigits = normalizePhoneDigitsOnly(phone);
    if (!pDigits) return true;
    for (const blocked of hiddenBlocklist) {
      if (!blocked) continue;
      if (areBrazilianPhonesEquivalent(pDigits, blocked)) return false;
    }
    return true;
  });

  return { data: filtered, error: null, hiddenBlocklist, debtorTelefonesById };
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
