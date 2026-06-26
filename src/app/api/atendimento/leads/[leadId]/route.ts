import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";

export async function GET(_: Request, context: { params: Promise<{ leadId: string }> }) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { leadId } = await context.params;
  const admin = createSupabaseAdminClient();

  const [{ data: lead, error: leadError }, { data: events, error: eventsError }] = await Promise.all([
    admin
      .from("atendimento_leads")
      .select("*, conversation:atendimento_conversations(*)")
      .eq("id", leadId)
      .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
      .maybeSingle(),
    admin
      .from("atendimento_history_events")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (leadError) {
    return Response.json({ ok: false, error: leadError.message }, { status: 500 });
  }
  if (eventsError) {
    return Response.json({ ok: false, error: eventsError.message }, { status: 500 });
  }
  if (!lead?.id) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  await admin
    .from("atendimento_leads")
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq("id", leadId);

  const conversationId = String((lead as any)?.conversation?.id ?? "");
  if (conversationId) {
    await admin
      .from("atendimento_messages")
      .update({ status: "lida", read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("sender_role", "lead")
      .is("read_at", null);
  }

  return Response.json({
    ok: true,
    lead: {
      ...(lead as any),
      conversation: (lead as any)?.conversation ?? null,
    },
    events: (events ?? []) as any[],
  });
}
