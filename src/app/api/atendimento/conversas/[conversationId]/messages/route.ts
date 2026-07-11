import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";

export async function GET(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { conversationId } = await context.params;
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.max(50, Math.min(500, limitRaw)) : 200;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("atendimento_messages")
      .select("id, conversation_id, sender_role, content_text, media_type, media_url, mime_type, file_name, file_size_bytes, created_at, status, read_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }

    const now = new Date().toISOString();
    void Promise.allSettled([
      admin
        .from("atendimento_conversations")
        .select("lead_id")
        .eq("id", conversationId)
        .maybeSingle()
        .then(async ({ data: conversation }) => {
          const leadId = String((conversation as any)?.lead_id ?? "").trim();
          if (!leadId) return;

          await admin
            .from("atendimento_leads")
            .update({
              unread_count: 0,
              updated_at: now,
              is_new_for_attendant: false,
            })
            .eq("id", leadId);
        }),
      admin
        .from("atendimento_messages")
        .update({ status: "lida", read_at: now })
        .eq("conversation_id", conversationId)
        .eq("sender_role", "lead")
        .is("read_at", null),
    ]);

    return Response.json({ ok: true, messages: (data ?? []) as any[] });
  } catch (error) {
    return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
