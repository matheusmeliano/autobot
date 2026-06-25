import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { normalizePlan } from "@/lib/plans";
import {
  ReportsClient,
  type ReportChartPoint,
  type ReportStats,
} from "@/components/app/reports/ReportsClient";

export default async function RelatoriosPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: profile }, { data: sub }] = await Promise.all([
    supabase.from("profiles").select("plano").maybeSingle(),
    supabase
      .from("subscriptions")
      .select("plano, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const plan = normalizePlan((profile as any)?.plano ?? (sub as any)?.plano ?? "teste");
  const canAccess = plan === "pro" || plan === "vitalicio";
  if (!canAccess) {
    redirect("/app/dashboard");
  }

  const now = new Date();
  const start30 = new Date(now);
  start30.setDate(now.getDate() - 29);
  start30.setHours(0, 0, 0, 0);
  const start30Iso = start30.toISOString();

  const [totalRes, scheduledRes, pendingRes, overdueRes, paidRes, chartRes] =
    await Promise.all([
      supabase.from("schedules").select("id", { count: "exact", head: true }),
      supabase
        .from("schedules")
        .select("id", { count: "exact", head: true })
        .in("status", ["agendado", "executando"]),
      supabase
        .from("schedules")
        .select("id", { count: "exact", head: true })
        .in("status", ["pendente", "suspeita_de_pagamento"]),
      supabase
        .from("schedules")
        .select("id", { count: "exact", head: true })
        .eq("status", "atrasado"),
      supabase
        .from("schedules")
        .select("id", { count: "exact", head: true })
        .in("status", ["pago", "executado"]),
      supabase.from("schedules").select("created_at").gte("created_at", start30Iso),
    ]);

  if (
    totalRes.error ||
    scheduledRes.error ||
    pendingRes.error ||
    overdueRes.error ||
    paidRes.error ||
    chartRes.error
  ) {
    return (
      <div>
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
    totalSchedules: totalRes.count ?? 0,
    scheduled: scheduledRes.count ?? 0,
    pending: pendingRes.count ?? 0,
    overdue: overdueRes.count ?? 0,
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
