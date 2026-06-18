import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DebtorsClient, type DebtorRow } from "@/components/app/debtors/DebtorsClient";
import Link from "next/link";
import { normalizePlan, type PlanKey } from "@/lib/plans";
import { applyCurrentMonthDebtorStatuses } from "@/lib/debtorChargeStatus";

export default async function ClientesPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, { data: profile }, { data: schedules }] = await Promise.all([
    supabase
      .from("debtors")
      .select(
        "id, nome, telefone, valor, vencimento, pix_key, observacoes, status, retry_weekdays, retry_time, retry_max_attempts, retry_interval_days, retry_auto_close_days, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("plano").maybeSingle(),
    supabase
      .from("schedules")
      .select("debtor_id, status, data_envio, charge_due_at, payment_received_at, schedule_timezone, closed_at")
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
  const rows = applyCurrentMonthDebtorStatuses({
    debtors: ((data ?? []) as DebtorRow[]).map((row) => ({
      ...row,
      status: row.status ?? "ativo",
    })),
    schedules: (schedules ?? []) as any[],
  });

  return <DebtorsClient initial={rows as DebtorRow[]} plan={plan} />;
}
