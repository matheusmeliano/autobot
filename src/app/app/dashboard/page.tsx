import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/app/DashboardClient";

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
        stats={{ totalReceived: 0, chargesSent: 0, messages: 0, whatsappStatus: "disconnected" }}
        chart={[]}
        activities={[]}
      />
    );
  }

  const now = new Date();
  const start7 = new Date(now);
  start7.setDate(now.getDate() - 6);
  start7.setHours(0, 0, 0, 0);
  const start7Iso = start7.toISOString();

  const [
    totalRes,
    sentRes,
    chartRes,
    whatsappRes,
    profileRes,
    activitiesRes,
  ] = await Promise.all([
    supabase
      .from("charges")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("charges")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["enviada", "paga"]),
    supabase
      .from("charges")
      .select("created_at")
      .eq("user_id", userId)
      .gte("created_at", start7Iso),
    supabase.from("whatsapp_instances").select("status").maybeSingle(),
    supabase.from("profiles").select("nome").eq("user_id", userId).maybeSingle(),
    supabase
      .from("charges")
      .select("id, status, created_at, debtors(nome)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const stats = {
    totalReceived: 0,
    chargesSent: sentRes.count ?? 0,
    messages: totalRes.count ?? 0,
    whatsappStatus: whatsappRes.data?.status ?? "disconnected",
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
    createdAt: String(r.created_at ?? ""),
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
