import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });

  const now = new Date();
  const start7 = new Date(now);
  start7.setDate(now.getDate() - 6);
  start7.setHours(0, 0, 0, 0);
  const start7Iso = start7.toISOString();

  const [totalRes, sentRes, chartRes, whatsappRes] = await Promise.all([
    supabase.from("charges").select("id", { count: "exact", head: true }),
    supabase
      .from("charges")
      .select("id", { count: "exact", head: true })
      .in("status", ["enviada", "paga"]),
    supabase.from("charges").select("created_at").gte("created_at", start7Iso),
    supabase.from("whatsapp_instances").select("status").maybeSingle(),
  ]);

  if (totalRes.error || sentRes.error || chartRes.error || whatsappRes.error) {
    return new Response("Falha ao carregar.", { status: 500 });
  }

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

  return Response.json({ stats, chart });
}

