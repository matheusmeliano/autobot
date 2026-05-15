"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

type ChartPoint = { name: string; value: number };

export function DashboardChart({ chart }: { chart: ChartPoint[] }) {
  return (
    <div className="mt-4 h-40">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chart}>
          <defs>
            <linearGradient id="dashValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity={0} />
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
            labelFormatter={(l: number | string) => `Dia: ${l}`}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="rgb(99 102 241)"
            strokeWidth={2}
            fill="url(#dashValue)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
