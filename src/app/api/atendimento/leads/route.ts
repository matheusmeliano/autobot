import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";

export async function GET(req: Request) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = String(searchParams.get("q") ?? "").trim().toLowerCase();
  const status = String(searchParams.get("status") ?? "").trim().toLowerCase();
  const stage = String(searchParams.get("stage") ?? "").trim().toLowerCase();
  const admin = createSupabaseAdminClient();

  const { data: leads, error } = await admin
    .from("atendimento_leads")
    .select(
      "*, conversation:atendimento_conversations(id, lead_id, public_link_id, channel, public_slug, bot_enabled, last_message_preview, last_message_at, created_at, updated_at)",
    )
    .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = ((leads ?? []) as any[]).filter((row) => {
    const name = String(row.full_name ?? "").toLowerCase();
    const phone = String(row.phone ?? "").toLowerCase();
    const cpf = String(row.cpf ?? "").toLowerCase();
    if (q && !name.includes(q) && !phone.includes(q) && !cpf.includes(q)) return false;
    if (status && String(row.status ?? "").toLowerCase() !== status) return false;
    if (stage && String(row.funnel_stage ?? "").toLowerCase() !== stage) return false;
    return true;
  });

  return Response.json({ ok: true, leads: rows });
}
