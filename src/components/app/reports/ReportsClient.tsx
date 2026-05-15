"use client";

import dynamic from "next/dynamic";

const ReportsChart = dynamic(
  () => import("./ReportsChart").then((m) => m.ReportsChart),
  {
    ssr: false,
    loading: () => <div className="mt-4 h-48 rounded-xl bg-white/[0.02]" />,
  },
);

export type ReportStats = {
  totalCharges: number;
  pending: number;
  sent: number;
  failed: number;
  paid: number;
};

export type ReportChartPoint = { name: string; value: number };

function Card({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs font-semibold text-white/55">{title}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

export function ReportsClient({
  stats,
  chart,
}: {
  stats: ReportStats;
  chart: ReportChartPoint[];
}) {
  return (
    <div>
      <div>
        <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
          RELATÓRIOS
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
          Visão geral
        </h1>
        <div className="mt-2 text-sm text-white/60">
          Dados reais das cobranças cadastradas.
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-5">
        <Card title="Total" value={String(stats.totalCharges)} />
        <Card title="Pendentes" value={String(stats.pending)} />
        <Card title="Enviadas" value={String(stats.sent)} />
        <Card title="Falhas" value={String(stats.failed)} />
        <Card title="Pagas" value={String(stats.paid)} />
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-sm font-semibold">Cobranças criadas (30 dias)</div>
        <ReportsChart chart={chart} />
      </div>
    </div>
  );
}
