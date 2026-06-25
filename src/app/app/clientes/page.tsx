import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DebtorsClient, type DebtorRow } from "@/components/app/debtors/DebtorsClient";
import Link from "next/link";
import { normalizePlan, type PlanKey } from "@/lib/plans";
import { applyCurrentMonthDebtorStatuses, deriveReferenceMonthDebtorChargeProgress } from "@/lib/debtorChargeStatus";
import { listAllClientesDebtors, listAllClientesSchedules } from "@/lib/clientesData";

export default async function ClientesPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, { data: profile }, { data: schedules, error: schedulesError }] = await Promise.all([
    listAllClientesDebtors(supabase),
    supabase.from("profiles").select("plano").maybeSingle(),
    listAllClientesSchedules(supabase),
  ]);

  if (error || schedulesError) {
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
