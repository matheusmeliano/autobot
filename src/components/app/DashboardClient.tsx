"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BadgeCheck, CalendarDays, MessageSquareText, Wallet } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

type StatPack = {
  schedulesMonth: number;
  schedulesExecuted: number;
  templates: number;
  whatsappStatus: string;
  receivableMonthTotal: number;
  receivableMonthPaid: number;
  receivableMonthRemaining: number;
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
    <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[var(--app-text-55)]">{title}</div>
          <div className="mt-2 truncate text-2xl font-semibold tracking-tight">{value}</div>
          {subtitle ? (
            <div className="mt-1 text-xs text-[var(--app-text-45)]">{subtitle}</div>
          ) : null}
        </div>
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--app-card)] ring-1 ring-[var(--app-border)]">
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

function brl(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function statusToLabel(status: string) {
  const s = status.trim().toLowerCase();
  if (s === "agendado") return "Agendado";
  if (s === "pausado") return "Pausado";
  if (s === "executado") return "Executado";
  if (s === "cancelado") return "Cancelado";
  return status;
}

function statusBadgeClassName(status: string) {
  return "border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-70)]";
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
  const pageSize = 3;
  const [activityPage, setActivityPage] = useState(1);
  const activityPages = Math.max(1, Math.ceil(activities.length / pageSize));
  const safeActivityPage = Math.min(activityPage, activityPages);

  useEffect(() => {
    if (activityPage !== safeActivityPage) setActivityPage(safeActivityPage);
  }, [activityPage, safeActivityPage]);

  const pagedActivities = useMemo(() => {
    if (!activities.length) return [];
    const start = (safeActivityPage - 1) * pageSize;
    return activities.slice(start, start + pageSize);
  }, [activities, safeActivityPage]);

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
          <div className="mt-2 text-sm text-[var(--app-text-60)]">{email}</div>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-2 text-xs font-semibold text-[var(--app-text-70)]">
          <span
            className={[
              "h-2 w-2 rounded-full",
              statusLabel === "Conectado" ? "bg-emerald-400" : "bg-[var(--app-text-30)]",
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

      <div className="mt-4 grid gap-4 min-[1201px]:grid-cols-3">
        <Card
          title="Total a receber (mês)"
          value={brl(stats.receivableMonthTotal)}
          subtitle=""
          icon={<Wallet className="h-5 w-5" />}
        />
        <Card
          title="Já recebidos (mês)"
          value={brl(stats.receivableMonthPaid)}
          subtitle=""
          icon={<Wallet className="h-5 w-5" />}
        />
        <Card
          title="Falta receber (mês)"
          value={brl(stats.receivableMonthRemaining)}
          subtitle=""
          icon={<Wallet className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 grid gap-4 min-[1201px]:grid-cols-5">
        <div className="flex h-full min-w-0 flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 min-[1201px]:col-span-3">
          <div className="text-sm font-semibold">Agendamentos criados (7 dias)</div>
          <div className="mt-1 text-xs text-[var(--app-text-45)]">
            Dados reais dos agendamentos cadastrados.
          </div>
          <div className="mt-4 min-h-[160px] flex-1">
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
                  tick={{ fill: "var(--app-text-45)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--app-modal-bg)",
                    border: "1px solid var(--app-border)",
                    borderRadius: 12,
                  }}
                  labelStyle={{ color: "var(--app-text-70)" }}
                  itemStyle={{ color: "var(--app-text-85)" }}
                  formatter={(v: any) => [v, "Quantidade"]}
                  labelFormatter={(l: any) => `Dia: ${l}`}
                />
                <Area type="monotone" dataKey="value" stroke="rgb(99 102 241)" strokeWidth={2} fill="url(#dashValue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex h-full min-w-0 flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 min-[1201px]:col-span-2">
          <div className="text-sm font-semibold">Atividades</div>
          <div className="mt-1 text-xs text-[var(--app-text-45)]">
            Histórico da agenda.
          </div>
          <div className="mt-4 flex-1 space-y-3">
            {activities.length ? (
              pagedActivities.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{item.debtorName}</div>
                      <div className="mt-1 text-xs text-[var(--app-text-55)]">
                        {statusToLabel(item.status)} • {dateTimeBR(item.dateTime)}
                      </div>
                    </div>
                    <span
                      className={[
                        "mt-0.5 inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold",
                        statusBadgeClassName(item.status),
                      ].join(" ")}
                    >
                      {statusToLabel(item.status)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-3">
                <div className="text-xs font-semibold">Nenhum agendamento ainda</div>
                <div className="mt-1 text-xs text-[var(--app-text-55)]">
                  Quando você criar agendamentos, eles aparecem aqui.
                </div>
              </div>
            )}
          </div>
          {activities.length > pageSize ? (
            <div className="mt-4 grid grid-cols-3 items-center">
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-sm font-semibold text-[var(--app-text-80)] hover:bg-[var(--app-hover)] disabled:opacity-40 disabled:hover:bg-[var(--app-card)]"
                onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                disabled={safeActivityPage <= 1}
                aria-label="Página anterior"
              >
                {"<"}
              </button>
              <div className="text-center text-xs font-semibold text-[var(--app-text-60)]">
                {safeActivityPage} / {activityPages}
              </div>
              <button
                type="button"
                className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] text-sm font-semibold text-[var(--app-text-80)] hover:bg-[var(--app-hover)] disabled:opacity-40 disabled:hover:bg-[var(--app-card)]"
                onClick={() => setActivityPage((p) => Math.min(activityPages, p + 1))}
                disabled={safeActivityPage >= activityPages}
                aria-label="Próxima página"
              >
                {">"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
