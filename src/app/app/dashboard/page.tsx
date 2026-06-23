import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/app/DashboardClient";
import { applyCurrentMonthDebtorStatuses } from "@/lib/debtorChargeStatus";
import { localDateInTimeZone } from "@/lib/recurrence";

function scheduleLocalMonthKey(value: string | null | undefined, timeZone: string) {
  const iso = String(value ?? "").trim();
  if (!iso) return null;
  try {
    return localDateInTimeZone(iso, timeZone).slice(0, 7);
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email ?? "";
  const userId = user?.id ?? null;

  if (!userId) {
    return (
      <DashboardClient
        email={email}
        name=""
        stats={{
          clients: 0,
          activeSchedules: 0,
          templates: 0,
          whatsappStatus: "disconnected",
          receivableMonthTotal: 0,
          receivableMonthPaid: 0,
          receivableMonthRemaining: 0,
        }}
        chartDates={[]}
        activities={[]}
      />
    );
  }

  const now = new Date();

  const [
    templatesRes,
    chartRes,
    whatsappRes,
    profileRes,
    activitiesRes,
    debtorsRes,
    schedulesRes,
    activeSchedulesRes,
  ] = await Promise.all([
    supabase
      .from("message_templates")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("schedules")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(5000),
    supabase.from("whatsapp_instances").select("status").maybeSingle(),
    supabase.from("profiles").select("nome").eq("user_id", userId).maybeSingle(),
    supabase
      .from("schedules")
      .select("id, status, data_envio, created_at, debtors(nome)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("debtors")
      .select("id, valor, status, accumulate_open_monthly_charges, debtor_charges(id, due_day, recurrence_month, recurrence_year, created_at)")
      .eq("user_id", userId)
      .limit(1000),
    supabase
      .from("schedules")
      .select(
        "debtor_id, charge_id, status, recurrence, data_envio, charge_due_at, payment_received_at, schedule_timezone, closed_at",
      )
      .eq("user_id", userId)
      .limit(2000),
    supabase
      .from("schedules")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["agendado", "pendente", "atrasado", "suspeita_de_pagamento", "executando"]),
  ]);

  const schedules = (schedulesRes.data ?? []) as any[];
  const currentMonthKey = localDateInTimeZone(now.toISOString(), "America/Sao_Paulo").slice(0, 7);
  const schedulesByDebtor = new Map<string, any[]>();

  for (const schedule of schedules) {
    const debtorId = String((schedule as any)?.debtor_id ?? "");
    if (!debtorId) continue;
    const list = schedulesByDebtor.get(debtorId) ?? [];
    list.push(schedule);
    schedulesByDebtor.set(debtorId, list);
  }

  const derivedDebtors = applyCurrentMonthDebtorStatuses({
    debtors: ((debtorsRes.data ?? []) as any[]).map((d) => ({
      ...d,
      status: String(d?.status ?? "ativo"),
      charges: ((d as any)?.debtor_charges ?? []).map((c: any) => ({
        ...c,
        due_day: typeof c?.due_day === "number" ? c.due_day : Number(c?.due_day),
        recurrence_month: typeof c?.recurrence_month === "number" ? c.recurrence_month : Number(c?.recurrence_month),
        recurrence_year: typeof c?.recurrence_year === "number" ? c.recurrence_year : Number(c?.recurrence_year),
      })),
    })),
    schedules: schedules as any[],
  }) as Array<{
    id: string;
    status: string;
    valor: number | null;
  }>;

  let receivableMonthTotal = 0;
  let receivableMonthPaid = 0;

  for (const d of derivedDebtors) {
    if (typeof d.valor !== "number" || Number.isNaN(d.valor)) continue;
    const debtorSchedules = schedulesByDebtor.get(String(d.id)) ?? [];
    const hasCurrentMonthCharge = debtorSchedules.some((row) => {
      const timeZone = String((row as any)?.schedule_timezone ?? "") || "America/Sao_Paulo";
      const dueMonthKey = scheduleLocalMonthKey(
        String((row as any)?.charge_due_at ?? "") || String((row as any)?.data_envio ?? "") || null,
        timeZone,
      );
      const paymentMonthKey = scheduleLocalMonthKey(
        String((row as any)?.payment_received_at ?? "") || null,
        timeZone,
      );
      return dueMonthKey === currentMonthKey || paymentMonthKey === currentMonthKey;
    });

    if (!hasCurrentMonthCharge) continue;

    const hasCurrentMonthPayment = debtorSchedules.some((row) => {
      const timeZone = String((row as any)?.schedule_timezone ?? "") || "America/Sao_Paulo";
      const paymentMonthKey = scheduleLocalMonthKey(
        String((row as any)?.payment_received_at ?? "") || null,
        timeZone,
      );
      if (paymentMonthKey === currentMonthKey) return true;

      const dueMonthKey = scheduleLocalMonthKey(
        String((row as any)?.charge_due_at ?? "") || String((row as any)?.data_envio ?? "") || null,
        timeZone,
      );
      return String((row as any)?.status ?? "").trim().toLowerCase() === "pago" && dueMonthKey === currentMonthKey;
    });

    receivableMonthTotal += d.valor;
    if (hasCurrentMonthPayment) {
      receivableMonthPaid += d.valor;
    }
  }

  const receivableMonthRemaining = Math.max(0, receivableMonthTotal - receivableMonthPaid);

  const stats = {
    clients: (debtorsRes.data ?? []).length,
    templates: templatesRes.count ?? 0,
    activeSchedules: activeSchedulesRes.count ?? 0,
    whatsappStatus: whatsappRes.data?.status ?? "disconnected",
    receivableMonthTotal,
    receivableMonthPaid,
    receivableMonthRemaining,
  };

  const chartDates = ((chartRes.data ?? []) as Array<{ created_at: string }>).map((row) =>
    String(row.created_at ?? ""),
  );

  const activities = ((activitiesRes.data ?? []) as any[]).map((r) => ({
    id: String(r.id),
    debtorName: String(r?.debtors?.nome ?? "-"),
    status: String(r.status ?? ""),
    dateTime: String(r.data_envio ?? r.created_at ?? ""),
  }));

  return (
    <DashboardClient
      email={email}
      name={(profileRes as any)?.data?.nome ?? ""}
      stats={stats}
      chartDates={chartDates}
      activities={activities}
    />
  );
}
