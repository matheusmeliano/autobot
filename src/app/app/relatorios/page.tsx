import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ReportsClient,
  type ReportChartPoint,
  type ReportStats,
} from "@/components/app/reports/ReportsClient";

export default async function RelatoriosPage() {
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const start30 = new Date(now);
  start30.setDate(now.getDate() - 29);
  start30.setHours(0, 0, 0, 0);
  const start30Iso = start30.toISOString();

  const [totalRes, pendingRes, sentRes, failedRes, paidRes, chartRes] =
    await Promise.all([
      supabase.from("charges").select("id", { count: "exact", head: true }),
      supabase
        .from("charges")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente"),
      supabase
        .from("charges")
        .select("id", { count: "exact", head: true })
        .eq("status", "enviada"),
      supabase
        .from("charges")
        .select("id", { count: "exact", head: true })
        .eq("status", "falhou"),
      supabase
        .from("charges")
        .select("id", { count: "exact", head: true })
        .eq("status", "paga"),
      supabase.from("charges").select("created_at").gte("created_at", start30Iso),
    ]);

  if (
    totalRes.error ||
    pendingRes.error ||
    sentRes.error ||
    failedRes.error ||
    paidRes.error ||
    chartRes.error
  ) {
    return (
      <div>
        <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
          RELATÓRIOS
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
          Visão geral
        </h1>
        <div className="mt-2 text-sm text-white/60">
          Não foi possível carregar os dados. Verifique se você está logado e se
          as tabelas existem.
        </div>
      </div>
    );
  }

  const stats: ReportStats = {
    totalCharges: totalRes.count ?? 0,
    pending: pendingRes.count ?? 0,
    sent: sentRes.count ?? 0,
    failed: failedRes.count ?? 0,
    paid: paidRes.count ?? 0,
  };

  const days = Array.from({ length: 30 }).map((_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (29 - i));
    const key = d.toISOString().slice(0, 10);
    return {
      key,
      name: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    };
  });

  const chartRows = (chartRes.data ?? []) as Array<{ created_at: string }>;
  const chart: ReportChartPoint[] = days.map((d) => ({
    name: d.name,
    value: chartRows.filter((r) => r.created_at.slice(0, 10) === d.key).length,
  }));

  return <ReportsClient stats={stats} chart={chart} />;
}
