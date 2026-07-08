import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";

export async function GET(_: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { conversationId } = await context.params;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("atendimento_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }

    return Response.json({ ok: true, messages: (data ?? []) as any[] });
  } catch (error) {
    return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
