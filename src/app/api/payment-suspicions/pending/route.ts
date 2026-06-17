import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient({ canSetCookies: true });
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("payment_suspicions")
    .select(
      "id, schedule_id, debtor_id, from_phone, message_text, media_url, ai_confidence, ai_reason, created_at, schedule:schedules(id, data_envio, status, recurrence), debtor:debtors(nome, telefone, valor, vencimento)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!data?.id) {
    return Response.json({ ok: true, pending: null });
  }

  return Response.json({
    ok: true,
    pending: {
      id: String((data as any).id),
      created_at: String((data as any).created_at ?? ""),
      from_phone: (data as any).from_phone ?? null,
      message_text: (data as any).message_text ?? null,
      media_url: (data as any).media_url ?? null,
      ai_confidence: (data as any).ai_confidence ?? null,
      ai_reason: (data as any).ai_reason ?? null,
      schedule: (data as any).schedule ?? null,
      debtor: (data as any).debtor ?? null,
    },
  });
}
