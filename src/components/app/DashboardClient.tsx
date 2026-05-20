"use client";

import { motion } from "framer-motion";
import { BadgeCheck, CalendarDays, MessageSquareText } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

type StatPack = {
  schedulesMonth: number;
  schedulesExecuted: number;
  templates: number;
  whatsappStatus: string;
};

type ActivityRow = {
  id: string;
  debtorName: string;
  status: string;
  dateTime: string;
};

type ChartPoint = { name: string; value: number };

function Card({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-white/55">{title}</div>
          <div className="mt-2 truncate text-2xl font-semibold tracking-tight">{value}</div>
          {subtitle ? <div className="mt-1 text-xs text-white/45">{subtitle}</div> : null}
        </div>
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.05] ring-1 ring-white/10">
          {icon}
        </div>
      </div>
    </div>
  );
}

function dateTimeBR(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

function statusToLabel(status: string) {
  const s = status.trim().toLowerCase();
  if (s === "agendado") return "Agendado";
  if (s === "pausado") return "Pausado";
  if (s === "executado") return "Executado";
  if (s === "cancelado") return "Cancelado";
  return status;
}

export function DashboardClient({
  email,
  name,
  stats,
  chart,
  activities,
}: {
  email: string;
  name?: string;
  stats: StatPack;
  chart: ChartPoint[];
  activities: ActivityRow[];
}) {
  const isConnected =
    stats.whatsappStatus === "connected" || stats.whatsappStatus === "configured";
  const statusLabel = isConnected ? "Conectado" : "Desconectado";

  const cleanedName = (name ?? "").trim();
  const greeting = cleanedName ? `Bem-vindo(a) ${cleanedName}!` : "Bem-vindo(a)!";

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col justify-between gap-4 min-[1201px]:flex-row min-[1201px]:items-end"
      >
        <div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight min-[1201px]:text-3xl">
            {greeting}
          </h1>
          <div className="mt-2 text-sm text-white/60">{email}</div>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-white/70">
          <span
            className={[
              "h-2 w-2 rounded-full shadow-[0_0_0_4px_rgba(16,185,129,0.12)]",
              statusLabel === "Conectado" ? "bg-emerald-400" : "bg-white/30",
            ].join(" ")}
          />
          WhatsApp: {statusLabel}
        </div>
      </motion.div>

      <div className="mt-6 grid gap-4 min-[1201px]:grid-cols-3">
        <Card
          title="Agendamentos (mês)"
          value={String(stats.schedulesMonth)}
          subtitle=""
          icon={<CalendarDays className="h-5 w-5" />}
        />
        <Card
          title="Executados"
          value={String(stats.schedulesExecuted)}
          subtitle=""
          icon={<BadgeCheck className="h-5 w-5" />}
        />
        <Card
          title="Templates (Mensagens)"
          value={String(stats.templates)}
          subtitle=""
          icon={<MessageSquareText className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 grid gap-4 min-[1201px]:grid-cols-5">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 min-[1201px]:col-span-3">
          <div className="text-sm font-semibold">Agendamentos criados (7 dias)</div>
          <div className="mt-1 text-xs text-white/45">
            Dados reais dos agendamentos cadastrados.
          </div>
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
                  formatter={(v: any) => [v, "Quantidade"]}
                  labelFormatter={(l: any) => `Dia: ${l}`}
                />
                <Area type="monotone" dataKey="value" stroke="rgb(99 102 241)" strokeWidth={2} fill="url(#dashValue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 min-[1201px]:col-span-2">
          <div className="text-sm font-semibold">Atividades</div>
          <div className="mt-1 text-xs text-white/45">
            Histórico da agenda.
          </div>
          <div className="mt-4 space-y-3">
            {activities.length ? (
              activities.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-white/10 bg-white/[0.02] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{item.debtorName}</div>
                      <div className="mt-1 text-xs text-white/55">
                        {statusToLabel(item.status)} • {dateTimeBR(item.dateTime)}
                      </div>
                    </div>
                    <span
                      className={[
                        "mt-0.5 inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold",
                        item.status.toLowerCase() === "executado"
                          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                          : item.status.toLowerCase() === "cancelado"
                            ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
                            : item.status.toLowerCase() === "pausado"
                              ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                            : "border-white/10 bg-white/[0.04] text-white/70",
                      ].join(" ")}
                    >
                      {statusToLabel(item.status)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="text-xs font-semibold">Nenhum agendamento ainda</div>
                <div className="mt-1 text-xs text-white/55">
                  Quando você criar agendamentos, eles aparecem aqui.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
