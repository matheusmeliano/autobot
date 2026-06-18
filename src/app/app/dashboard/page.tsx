import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/app/DashboardClient";
import { applyCurrentMonthDebtorStatuses } from "@/lib/debtorChargeStatus";
import { getScheduleChargeAmount } from "@/lib/chargeAccumulation";

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
          schedulesMonth: 0,
          schedulesExecuted: 0,
          templates: 0,
          whatsappStatus: "disconnected",
          receivableMonthTotal: 0,
          receivableMonthPaid: 0,
          receivableMonthRemaining: 0,
        }}
        chart={[]}
        activities={[]}
      />
    );
  }

  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  startMonth.setHours(0, 0, 0, 0);
  const startMonthIso = startMonth.toISOString();
  const start7 = new Date(now);
  start7.setDate(now.getDate() - 6);
  start7.setHours(0, 0, 0, 0);
  const start7Iso = start7.toISOString();

  const [
    schedulesMonthRes,
    schedulesExecutedRes,
    templatesRes,
    chartRes,
    whatsappRes,
    profileRes,
    activitiesRes,
    debtorsRes,
    schedulesForAmountsRes,
  ] = await Promise.all([
    supabase
      .from("schedules")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", startMonthIso),
    supabase
      .from("schedules")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "executado"),
    supabase
      .from("message_templates")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("schedules")
      .select("created_at")
      .eq("user_id", userId)
      .gte("created_at", start7Iso),
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
      .select("id, valor, status, accumulate_open_monthly_charges")
      .eq("user_id", userId)
      .limit(1000),
    supabase
      .from("schedules")
      .select(
        "debtor_id, status, recurrence, data_envio, charge_due_at, payment_received_at, schedule_timezone, closed_at",
      )
      .eq("user_id", userId)
      .limit(2000),
  ]);

  const schedulesForAmounts = (schedulesForAmountsRes.data ?? []) as any[];
  const schedulesByDebtor = new Map<string, any[]>();
  for (const s of schedulesForAmounts) {
    const debtorId = String((s as any)?.debtor_id ?? "");
    if (!debtorId) continue;
    const list = schedulesByDebtor.get(debtorId) ?? [];
    list.push(s);
    schedulesByDebtor.set(debtorId, list);
  }

  const derivedDebtors = applyCurrentMonthDebtorStatuses({
    debtors: ((debtorsRes.data ?? []) as any[]).map((d) => ({
      ...d,
      status: String(d?.status ?? "ativo"),
    })),
    schedules: schedulesForAmounts as any[],
  }) as Array<{
    id: string;
    status: string;
    valor: number | null;
    accumulate_open_monthly_charges: boolean | null;
  }>;

  const nowIso = new Date().toISOString();
  let receivableMonthTotal = 0;
  let receivableMonthPaid = 0;

  for (const d of derivedDebtors) {
    if (typeof d.valor !== "number" || Number.isNaN(d.valor)) continue;

    const list = schedulesByDebtor.get(String(d.id)) ?? [];
    const primary = list.find((r) => String((r as any)?.recurrence ?? "") === "monthly") ?? list[0] ?? null;

    const amount =
      getScheduleChargeAmount({
        baseAmount: d.valor,
        accumulateOpenMonthlyCharges: Boolean(d.accumulate_open_monthly_charges),
        recurrence: primary ? String((primary as any)?.recurrence ?? "") : null,
        status: primary ? String((primary as any)?.status ?? "") : null,
        closedAt: primary ? String((primary as any)?.closed_at ?? "") || null : null,
        chargeDueAt: primary ? String((primary as any)?.charge_due_at ?? "") || null : null,
        dataEnvio: primary ? String((primary as any)?.data_envio ?? "") || null : null,
        nowUtcIso: nowIso,
        timeZone: primary ? String((primary as any)?.schedule_timezone ?? "") || "America/Sao_Paulo" : null,
      }) ?? 0;

    receivableMonthTotal += amount;
    if (String(d.status ?? "").trim().toLowerCase() === "pago") {
      receivableMonthPaid += amount;
    }
  }

  const receivableMonthRemaining = Math.max(0, receivableMonthTotal - receivableMonthPaid);

  const stats = {
    schedulesMonth: schedulesMonthRes.count ?? 0,
    schedulesExecuted: schedulesExecutedRes.count ?? 0,
    templates: templatesRes.count ?? 0,
    whatsappStatus: whatsappRes.data?.status ?? "disconnected",
    receivableMonthTotal,
    receivableMonthPaid,
    receivableMonthRemaining,
  };

  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    return { key, label: weekdays[d.getDay()] ?? "" };
  });

  const chartRows = (chartRes.data ?? []) as Array<{ created_at: string }>;
  const chart = days.map((d) => ({
    name: d.label,
    value: chartRows.filter((c) => c.created_at.slice(0, 10) === d.key).length,
  }));

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
      chart={chart}
      activities={activities}
    />
  );
}
