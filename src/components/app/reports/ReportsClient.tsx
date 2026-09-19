"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { buildChartPoints, type ChartFilter, type ChartPoint } from "@/lib/chart";

export type ReportStats = {
  totalSchedules: number;
  scheduled: number;
  executed: number;
  unpaid: number;
  paid: number;
};

function Card({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-4 shadow-none">
      <div className="text-xs font-semibold text-[var(--app-text-55)]">{title}</div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--app-text-85)]">{value}</div>
    </div>
  );
}

export function ReportsClient({
  stats,
  createdAtDates,
}: {
  stats: ReportStats;
  createdAtDates: string[];
}) {
  const [chartFilter, setChartFilter] = useState<ChartFilter>("days");
  const chart = useMemo(
    () => buildChartPoints(chartFilter, createdAtDates) as (ChartPoint & { name: string; value: number })[],
    [chartFilter, createdAtDates],
  );

  return (
    <div>
      <div>
        <h1 className="mt-0 text-xl font-bold tracking-tight whitespace-nowrap max-[420px]:whitespace-normal sm:text-2xl min-[1201px]:text-[1.6rem] leading-[1.15] text-[var(--app-text-85)]">
          Visão geral
        </h1>
        <div className="mt-2 text-sm text-[var(--app-text-60)]">
          Dados reais em tempo real com a mesma base visível de `agendar`.
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-5">
        <Card title="Total" value={String(stats.totalSchedules)} />
        <Card title="Agendados" value={String(stats.scheduled)} />
        <Card title="Executados" value={String(stats.executed)} />
        <Card title="Não pagos" value={String(stats.unpaid)} />
        <Card title="Pagos" value={String(stats.paid)} />
      </div>

      <div className="mt-6 rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-4 shadow-none">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-base font-bold tracking-tight text-[var(--app-text-85)]">Agendamentos criados</div>
            <div className="mt-1 text-xs text-[var(--app-text-45)]">
              Dados reais dos agendamentos cadastrados.
            </div>
          </div>
          <div className="inline-flex w-full min-w-0 shrink items-center gap-1 overflow-hidden rounded-full border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-1 sm:w-auto">
            {[
              { key: "days", label: "Dias" },
              { key: "weeks", label: "Semanas" },
              { key: "months", label: "Meses" },
              { key: "years", label: "Anos" },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                className={[
                  "flex min-w-0 flex-1 items-center justify-center truncate rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors sm:flex-none sm:px-4",
                  chartFilter === option.key
                    ? "bg-[var(--app-active)] text-[#9a3412] font-semibold"
                    : "text-[var(--app-text-55)] hover:text-[var(--app-text-85)]",
                ].join(" ")}
                onClick={() => setChartFilter(option.key as ChartFilter)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 h-48 min-h-[160px]">
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
                tick={{ fill: "var(--app-text-45)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--app-modal-bg)",
                  border: "1px solid var(--app-border)",
                  borderRadius: 12,
                  boxShadow: "none",
                }}
                labelStyle={{ color: "var(--app-text-70)" }}
                itemStyle={{ color: "var(--app-text-85)" }}
                formatter={(v: any) => [v, "Quantidade"]}
                labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.label ?? ""}
              />
              <Area type="monotone" dataKey="value" stroke="rgb(16 185 129)" strokeWidth={2} fill="url(#repValue)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
