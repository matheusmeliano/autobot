import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DebtorsClient, type DebtorRow } from "@/components/app/debtors/DebtorsClient";
import Link from "next/link";
import { normalizePlan, type PlanKey } from "@/lib/plans";
import { applyCurrentMonthDebtorStatuses, deriveReferenceMonthDebtorChargeProgress } from "@/lib/debtorChargeStatus";

export default async function ClientesPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, { data: profile }, { data: schedules }] = await Promise.all([
    supabase
      .from("debtors")
      .select(
        "id, nome, telefone, valor, vencimento, pix_key, observacoes, status, accumulate_open_monthly_charges, skip_weekends_on_first_charge, retry_weekdays, retry_time, retry_max_attempts, retry_interval_days, retry_auto_close_days, created_at, debtor_charges(id, amount, due_day, recurrence_month, recurrence_year, created_at)",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("plano").maybeSingle(),
    supabase
      .from("schedules")
      .select(
        "debtor_id, charge_id, status, recurrence, data_envio, charge_due_at, payment_received_at, schedule_timezone, closed_at",
      )
      .limit(1000),
  ]);

  if (error) {
    return (
      <div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
          Clientes e devedores
        </h1>
        <div className="mt-2 text-sm text-white/60">
          A tabela ainda não existe no Supabase ou o RLS ainda não foi aplicado.
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="text-sm font-semibold">Como corrigir</div>
          <div className="mt-2 text-sm text-white/60">
            Rode a migration SQL de SaaS no Supabase e recarregue esta página.
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/app/dashboard"
              className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90"
            >
              Voltar para o painel
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.06]"
            >
              Ir para a página inicial
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const plan = normalizePlan((profile as any)?.plano) as PlanKey;
  const nowUtcIso = new Date().toISOString();
  const schedulesByDebtor = new Map<string, any[]>();
  for (const s of (schedules ?? []) as any[]) {
    const debtorId = String((s as any)?.debtor_id ?? "");
    if (!debtorId) continue;
    const list = schedulesByDebtor.get(debtorId) ?? [];
    list.push(s);
    schedulesByDebtor.set(debtorId, list);
  }

  const rowsWithStatus = applyCurrentMonthDebtorStatuses({
    debtors: ((data ?? []) as any[]).map((row) => ({
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
    schedules: (schedules ?? []) as any[],
  });

  const rows = (rowsWithStatus as any[]).map((row) => {
    const prog = deriveReferenceMonthDebtorChargeProgress(
      row.charges ?? [],
      schedulesByDebtor.get(String(row.id)) ?? [],
      nowUtcIso,
    );
    return { ...row, progress_paid: prog.paid, progress_total: prog.total };
  });

  return <DebtorsClient initial={rows as DebtorRow[]} plan={plan} />;
}
