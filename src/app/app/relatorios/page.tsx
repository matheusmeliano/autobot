import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { normalizePlan } from "@/lib/plans";
import {
  ReportsClient,
  type ReportChartPoint,
  type ReportStats,
} from "@/components/app/reports/ReportsClient";
import { buildAgendaRows } from "@/lib/agendaRows";
import {
  listAllAgendarDebtors,
  listAllAgendarScheduleRuns,
  listAllAgendarSchedules,
} from "@/lib/agendarData";
import { localDateInTimeZone } from "@/lib/recurrence";
import { BRAZIL_TIMEZONES, type BrazilTimeZone } from "@/lib/timezone";
import { deriveAgendarVisualStatus } from "@/lib/agendarStatus";

function addDaysToLocalDate(localDate: string, days: number) {
  const [year, month, day] = localDate.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function localDateLabel(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
  }).format(base);
}

export default async function RelatoriosPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: profile }, { data: sub }] = await Promise.all([
    supabase.from("profiles").select("plano, timezone").maybeSingle(),
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

  const [schedulesRes, scheduleRunsRes, debtorsRes] = await Promise.all([
    listAllAgendarSchedules(supabase),
    listAllAgendarScheduleRuns(supabase),
    listAllAgendarDebtors(supabase),
  ]);

  if (schedulesRes.error || scheduleRunsRes.error || debtorsRes.error) {
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

  const latestExecutedRunBySchedule = new Map<string, string>();
  for (const run of scheduleRunsRes.data ?? []) {
    const scheduleId = String((run as any)?.schedule_id ?? "");
    const scheduledFor = String((run as any)?.scheduled_for ?? "");
    if (!scheduleId || !scheduledFor || latestExecutedRunBySchedule.has(scheduleId)) continue;
    latestExecutedRunBySchedule.set(scheduleId, scheduledFor);
  }

  const tzRaw = (profile as any)?.timezone;
  const timeZone: BrazilTimeZone = BRAZIL_TIMEZONES.includes(tzRaw) ? (tzRaw as BrazilTimeZone) : "America/Sao_Paulo";
  const todayLocalDate = localDateInTimeZone(new Date().toISOString(), timeZone);
  const start30LocalDate = addDaysToLocalDate(todayLocalDate, -29);
  const rows = buildAgendaRows({
    debtors: (debtorsRes.data ?? []) as any[],
    schedules: (schedulesRes.data ?? []) as any[],
    latestExecutedRunBySchedule,
    defaultTimeZone: timeZone,
  });

  const visualStatuses = rows.map((row) => deriveAgendarVisualStatus(row, timeZone));
  const stats: ReportStats = {
    totalSchedules: rows.length,
    scheduled: visualStatuses.filter((status) => status.label === "Agendado").length,
    executed: visualStatuses.filter((status) => status.label === "Executado").length,
    unpaid: visualStatuses.filter(
      (status) => status.label === "Executado" && status.subtitle === "Não pago",
    ).length,
    paid: visualStatuses.filter(
      (status) => status.label === "Executado" && status.subtitle === "Pago",
    ).length,
  };

  const days = Array.from({ length: 30 }).map((_, i) => {
    const key = addDaysToLocalDate(start30LocalDate, i);
    return {
      key,
      name: localDateLabel(key),
    };
  });

  const chartRows = rows.filter((row) => {
    const createdAt = String(row.created_at ?? "").trim();
    if (!createdAt) return false;
    return localDateInTimeZone(createdAt, timeZone) >= start30LocalDate;
  });
  const chart: ReportChartPoint[] = days.map((d) => ({
    name: d.name,
    value: chartRows.filter((row) => localDateInTimeZone(String(row.created_at ?? ""), timeZone) === d.key).length,
  }));

  return <ReportsClient stats={stats} chart={chart} />;
}
