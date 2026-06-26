import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendHistoryEvent, requireAtendimentoUser, syncConversationPreview } from "@/lib/atendimento/server";

export async function POST(req: Request, context: { params: Promise<{ conversationId: string }> }) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { conversationId } = await context.params;
  const body = await req.json().catch(() => null);
  const contentText = String(body?.content_text ?? "").trim();
  const mediaType = String(body?.media_type ?? "text").trim() || "text";
  const mediaUrl = String(body?.media_url ?? "").trim() || null;
  const mimeType = String(body?.mime_type ?? "").trim() || null;

  if (!contentText && !mediaUrl) {
    return Response.json({ ok: false, error: "empty_message" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: conversation } = await admin
    .from("atendimento_conversations")
    .select("id, lead_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversation?.id) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("atendimento_messages")
    .insert({
      conversation_id: conversationId,
      sender_role: "attendant",
      content_text: contentText || null,
      media_type: mediaType,
      media_url: mediaUrl,
      mime_type: mimeType,
      status: "entregue",
      sent_at: nowIso,
      delivered_at: nowIso,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  await syncConversationPreview({
    conversationId,
    contentText: contentText || `[${mediaType}]`,
    createdAt: nowIso,
  });
  await admin
    .from("atendimento_leads")
    .update({ last_interaction_at: nowIso, updated_at: nowIso })
    .eq("id", String(conversation.lead_id));
  await appendHistoryEvent({
    leadId: String(conversation.lead_id),
    conversationId,
    eventType: "message_sent",
    title: "Mensagem enviada pelo atendente",
    details: { content_text: contentText || null, media_type: mediaType },
    actorType: "attendant",
    actorEmail: auth.user.email ?? null,
  });

  return Response.json({ ok: true, message: data });
}
