"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

export type ReportChartPoint = { name: string; value: number };

export function ReportsChart({ chart }: { chart: ReportChartPoint[] }) {
  return (
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
            formatter={(v: number | string) => [v, "Quantidade"]}
            labelFormatter={(l: number | string) => `Data: ${l}`}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="rgb(16 185 129)"
            strokeWidth={2}
            fill="url(#repValue)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
