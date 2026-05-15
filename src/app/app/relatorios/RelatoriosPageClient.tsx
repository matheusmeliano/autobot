"use client";

import { ReportsClient, type ReportChartPoint, type ReportStats } from "@/components/app/reports/ReportsClient";
import { useCachedJson } from "@/lib/app/useCachedJson";

type Payload = { stats: ReportStats; chart: ReportChartPoint[] };

function Skeleton() {
  return (
    <div className="animate-pulse">
      <div>
        <div className="h-3 w-28 rounded bg-white/10" />
        <div className="mt-3 h-8 w-48 rounded bg-white/10" />
        <div className="mt-3 h-4 w-64 rounded bg-white/10" />
      </div>

      <div className="mt-6 grid gap-4 min-[1201px]:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="h-3 w-20 rounded bg-white/10" />
            <div className="mt-3 h-7 w-16 rounded bg-white/10" />
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="h-4 w-60 rounded bg-white/10" />
        <div className="mt-4 h-48 rounded-xl bg-white/5" />
      </div>
    </div>
  );
}

export function RelatoriosPageClient() {
  const { data, loading, error } = useCachedJson<Payload>({
    key: "app:relatorios",
    url: "/app/relatorios/data",
    maxAgeMs: 60_000,
  });

  if (!data && loading) return <Skeleton />;

  if (error || !data) {
    return (
      <div>
        <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
          RELATÓRIOS
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight min-[1201px]:text-3xl">
          Visão geral
        </h1>
        <div className="mt-2 text-sm text-white/60">
          Não foi possível carregar os dados. Tente novamente.
        </div>
      </div>
    );
  }

  return <ReportsClient stats={data.stats} chart={data.chart} />;
}

