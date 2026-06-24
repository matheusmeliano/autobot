"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CalendarDays, MessageSquareText, Users, Wallet } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { localDateInTimeZone } from "@/lib/recurrence";
import { type BrazilTimeZone } from "@/lib/timezone";

type StatPack = {
  clients: number;
  templates: number;
  activeSchedules: number;
  whatsappStatus: string;
  receivableMonthTotal: number;
  receivableMonthPaid: number;
  receivableMonthRemaining: number;
};

type ActivityRow = {
  id: string;
  debtorName: string;
  status: string;
  dataEnvio: string;
  chargeDueAt: string | null;
  lastExecutedScheduledFor: string | null;
  paymentReceivedAt: string | null;
};

type ChartFilter = "days" | "weeks" | "months" | "years";
type ChartPoint = { name: string; value: number; label: string };

const CHART_TIME_ZONE = "America/Sao_Paulo";

function formatDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHART_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
}

function zonedDateKey(date: Date) {
  const parts = formatDateParts(date);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function startOfZonedDay(date: Date) {
  const parts = formatDateParts(date);
  return new Date(parts.year, parts.month - 1, parts.day);
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

function startOfWeek(date: Date) {
  const start = startOfZonedDay(date);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(start, diff);
}

function monthKey(date: Date) {
  const parts = formatDateParts(date);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}`;
}

function yearKey(date: Date) {
  return String(formatDateParts(date).year);
}

function shortDateLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: CHART_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function shortMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: CHART_TIME_ZONE,
    month: "short",
  })
    .format(date)
    .replace(".", "");
}

function weekdayLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: CHART_TIME_ZONE,
    weekday: "short",
  })
    .format(date)
    .replace(".", "");
}

function buildChartPoints(filter: ChartFilter, chartDates: string[]): ChartPoint[] {
  const validDates = chartDates
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));

  const now = new Date();

  if (filter === "days") {
    const buckets = Array.from({ length: 7 }).map((_, index) => {
      const day = addDays(startOfZonedDay(now), -(6 - index));
      return {
        key: zonedDateKey(day),
        name: weekdayLabel(day),
        label: shortDateLabel(day),
      };
    });

    return buckets.map((bucket) => ({
      name: bucket.name,
      label: bucket.label,
      value: validDates.filter((date) => zonedDateKey(date) === bucket.key).length,
    }));
  }

  if (filter === "weeks") {
    const currentWeek = startOfWeek(now);
    const buckets = Array.from({ length: 8 }).map((_, index) => {
      const weekStart = addDays(currentWeek, (-(7 - index) * 7));
      const weekEnd = addDays(weekStart, 6);
      return {
        key: zonedDateKey(weekStart),
        name: shortDateLabel(weekStart),
        label: `${shortDateLabel(weekStart)} a ${shortDateLabel(weekEnd)}`,
      };
    });

    return buckets.map((bucket) => ({
      name: bucket.name,
      label: `Semana ${bucket.label}`,
      value: validDates.filter((date) => zonedDateKey(startOfWeek(date)) === bucket.key).length,
    }));
  }

  if (filter === "months") {
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const buckets = Array.from({ length: 12 }).map((_, index) => {
      const month = addMonths(currentMonth, -(11 - index));
      const monthLabel = shortMonthLabel(month);
      const monthYear = new Intl.DateTimeFormat("pt-BR", {
        timeZone: CHART_TIME_ZONE,
        month: "long",
        year: "numeric",
      }).format(month);
      return {
        key: monthKey(month),
        name: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1),
        label: monthYear.charAt(0).toUpperCase() + monthYear.slice(1),
      };
    });

    return buckets.map((bucket) => ({
      name: bucket.name,
      label: bucket.label,
      value: validDates.filter((date) => monthKey(date) === bucket.key).length,
    }));
  }

  const currentYear = new Date(now.getFullYear(), 0, 1);
  const buckets = Array.from({ length: 5 }).map((_, index) => {
    const yearDate = addMonths(currentYear, (-(4 - index) * 12));
    const label = String(yearDate.getFullYear());
    return {
      key: yearKey(yearDate),
      name: label,
      label,
    };
  });

  return buckets.map((bucket) => ({
    name: bucket.name,
    label: bucket.label,
    value: validDates.filter((date) => yearKey(date) === bucket.key).length,
  }));
}

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

function dateTimeBR(v: string, timeZone: BrazilTimeZone) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
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
  if (s === "pendente") return "Agendado";
  if (s === "suspeita_de_pagamento") return "Agendado";
  if (s === "pausado") return "Pausado";
  if (s === "executado") return "Executado";
  if (s === "cancelado") return "Cancelado";
  if (s === "pago") return "Executado";
  if (s === "atrasado") return "Atrasado";
  return status;
}

function statusBadgeClassName(status: string) {
  const s = status.trim().toLowerCase();
  if (s === "executado" || s === "pago") return "bg-emerald-600 text-[rgb(255,255,255)]";
  if (s === "atrasado" || s === "cancelado") return "bg-rose-600 text-[rgb(255,255,255)]";
  return "bg-yellow-600 text-[rgb(255,255,255)]";
}

function normalizeActivityStatus(status: string) {
  const s = status.trim().toLowerCase();
  if (s === "executado" || s === "pago") return "Executado";
  if (s === "atrasado") return "Atrasado";
  if (s === "cancelado") return "Cancelado";
  if (s === "pausado") return "Pausado";
  return "Agendado";
}

function hasExecutedCurrentInstance(activity: ActivityRow) {
  const normalizedStatus = String(activity.status ?? "").trim().toLowerCase();
  if (normalizedStatus === "executado" || normalizedStatus === "pago") return true;
  if (String(activity.paymentReceivedAt ?? "").trim()) return true;

  const lastExecutedAt = String(activity.lastExecutedScheduledFor ?? "").trim();
  const scheduledFor = String(activity.dataEnvio ?? "").trim();
  if (lastExecutedAt && scheduledFor) {
    const executedMs = new Date(lastExecutedAt).getTime();
    const scheduledMs = new Date(scheduledFor).getTime();
    if (!Number.isNaN(executedMs) && !Number.isNaN(scheduledMs) && executedMs === scheduledMs) {
      return true;
    }
  }

  return false;
}

function getActivityVisualStatus(activity: ActivityRow, timeZone: BrazilTimeZone) {
  const dueMoment = activity.chargeDueAt ?? activity.dataEnvio;
  const currentLocalDate = localDateInTimeZone(new Date().toISOString(), timeZone);
  const dueLocalDate = localDateInTimeZone(String(dueMoment), timeZone);
  const isOverdue =
    Boolean(dueLocalDate) && Boolean(currentLocalDate) && dueLocalDate < currentLocalDate;
  const label = hasExecutedCurrentInstance(activity)
    ? "Executado"
    : isOverdue
      ? "Atrasado"
      : normalizeActivityStatus(activity.status);
  return { label, className: statusBadgeClassName(label) };
}

export function DashboardClient({
  email,
  name,
  stats,
  chartDates,
  activities,
  timeZone,
}: {
  email: string;
  name?: string;
  stats: StatPack;
  chartDates: string[];
  activities: ActivityRow[];
  timeZone: BrazilTimeZone | null;
}) {
  const pageSize = 3;
  const effectiveTimeZone: BrazilTimeZone = timeZone ?? "America/Sao_Paulo";
  const [activityPage, setActivityPage] = useState(1);
  const [chartFilter, setChartFilter] = useState<ChartFilter>("days");
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

  const chart = useMemo(() => buildChartPoints(chartFilter, chartDates), [chartDates, chartFilter]);

  const isConnected =
    stats.whatsappStatus === "connected" || stats.whatsappStatus === "configured";
  const statusLabel = isConnected ? "Conectado" : "Desconectado";
  const operationMonthLabel = useMemo(() => {
    const month = new Intl.DateTimeFormat("pt-BR", {
      timeZone: effectiveTimeZone,
      month: "long",
    }).format(new Date());
    return month.charAt(0).toUpperCase() + month.slice(1);
  }, [effectiveTimeZone]);

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
        <div className="hidden min-[1201px]:block">
          <h1 className="mt-2 text-lg font-semibold tracking-tight whitespace-nowrap max-[420px]:whitespace-normal sm:text-xl min-[1201px]:text-[1.75rem]">
            {greeting}
          </h1>
        </div>

        <div className="hidden w-full flex-wrap items-center gap-2 min-[1201px]:flex min-[1201px]:justify-end">
          <div className="inline-flex w-full items-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-2 text-xs font-semibold text-[var(--app-text-70)] min-[1201px]:w-auto">
            <span
              className={[
                "h-2 w-2 rounded-full",
                statusLabel === "Conectado" ? "bg-emerald-400" : "bg-[var(--app-text-30)]",
              ].join(" ")}
            />
            WhatsApp: {statusLabel}
          </div>
          <div className="inline-flex w-full items-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-2 text-xs font-semibold text-[var(--app-text-70)] min-[1201px]:w-auto">
            <CalendarDays className="h-3.5 w-3.5" />
            Operação: {operationMonthLabel}
          </div>
        </div>
      </motion.div>

      <div className="mt-0 grid gap-4 min-[1201px]:mt-6 min-[1201px]:grid-cols-3">
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

      <div className="mt-4 grid gap-4 min-[1201px]:grid-cols-3">
        <Card
          title="Clientes"
          value={String(stats.clients)}
          subtitle=""
          icon={<Users className="h-5 w-5" />}
        />
        <Card
          title="Mensagens (template)"
          value={String(stats.templates)}
          subtitle=""
          icon={<MessageSquareText className="h-5 w-5" />}
        />
        <Card
          title="Agendamentos ativos"
          value={String(stats.activeSchedules)}
          subtitle=""
          icon={<CalendarDays className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 grid gap-4 min-[1201px]:grid-cols-5">
        <div className="flex h-full min-w-0 flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 min-[1201px]:col-span-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm font-semibold">Agendamentos criados</div>
              <div className="mt-1 text-xs text-[var(--app-text-45)]">
                Dados reais dos agendamentos cadastrados.
              </div>
            </div>
            <div className="inline-flex w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] p-1 sm:w-auto">
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
                    "flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none",
                    chartFilter === option.key
                      ? "bg-[var(--app-hover)] text-[var(--app-text-85)]"
                      : "text-[var(--app-text-55)] hover:text-[var(--app-text-85)]",
                  ].join(" ")}
                  onClick={() => setChartFilter(option.key as ChartFilter)}
                >
                  {option.label}
                </button>
              ))}
            </div>
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
                  labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.label ?? ""}
                />
                <Area type="monotone" dataKey="value" stroke="rgb(99 102 241)" strokeWidth={2} fill="url(#dashValue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex h-full min-w-0 flex-col rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-4 min-[1201px]:col-span-2">
          <div className="text-sm font-semibold">Atividades</div>
          <div className="mt-1 text-xs text-[var(--app-text-45)]">
            Mais recentes da agenda.
          </div>
          <div className="mt-4 flex-1 space-y-3">
            {activities.length ? (
              pagedActivities.map((item) => {
                const visualStatus = getActivityVisualStatus(item, effectiveTimeZone);
                const dueMoment = item.chargeDueAt ?? item.dataEnvio;
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold">{item.debtorName}</div>
                        <div className="mt-1 text-xs text-[var(--app-text-55)]">
                          {visualStatus.label} • {dateTimeBR(dueMoment, effectiveTimeZone)}
                        </div>
                      </div>
                      <span
                        className={`mt-0.5 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${visualStatus.className}`}
                      >
                        {visualStatus.label}
                      </span>
                    </div>
                  </div>
                );
              })
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
