"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

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
        <div className="mt-4 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart}>
              <defs>
                <linearGradient id="repValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="name"
                tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "rgba(15, 23, 42, 0.9)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 12,
                }}
                labelStyle={{ color: "rgba(255,255,255,0.7)" }}
                itemStyle={{ color: "white" }}
                formatter={(v: any) => [v, "Quantidade"]}
                labelFormatter={(l: any) => `Data: ${l}`}
              />
              <Area type="monotone" dataKey="value" stroke="rgb(16 185 129)" strokeWidth={2} fill="url(#repValue)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
