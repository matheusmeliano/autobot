import {
  appendHistoryEvent,
  getAtendimentoActivePresenceCount,
  getAtendimentoConversationAccessForAttendant,
  sendAtendimentoWhatsAppText,
  syncConversationPreview,
} from "@/lib/atendimento/server";
import { getAtendimentoConversationPreviewText } from "@/lib/atendimento/files";

export async function POST(req: Request, context: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await context.params;
  const access = await getAtendimentoConversationAccessForAttendant(conversationId);
  if (!access.ok) {
    return Response.json({ ok: false, error: access.error }, { status: access.status });
  }

  const body = await req.json().catch(() => null);
  const contentText = String(body?.content_text ?? "").trim();
  const mediaType = String(body?.media_type ?? "text").trim() || "text";
  const mediaUrl = String(body?.media_url ?? "").trim() || null;
  const mimeType = String(body?.mime_type ?? "").trim() || null;
  const fileName = String(body?.file_name ?? "").trim() || null;
  const fileSizeBytesRaw = Number(body?.file_size_bytes ?? 0);
  const fileSizeBytes = Number.isFinite(fileSizeBytesRaw) && fileSizeBytesRaw > 0 ? fileSizeBytesRaw : null;

  if (!contentText && !mediaUrl) {
    return Response.json({ ok: false, error: "empty_message" }, { status: 400 });
  }

  const { admin, auth, conversation } = access;

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
      file_name: fileName,
      file_size_bytes: fileSizeBytes,
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
    contentText: getAtendimentoConversationPreviewText({ contentText, mediaType, fileName }),
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
    details: {
      content_text: contentText || null,
      media_type: mediaType,
      media_url: mediaUrl,
      mime_type: mimeType,
      file_name: fileName,
      file_size_bytes: fileSizeBytes,
    },
    actorType: "attendant",
    actorEmail: auth.user.email ?? null,
  });

  const { data: lead } = await admin
    .from("atendimento_leads")
    .select("id, full_name, phone")
    .eq("id", String(conversation.lead_id))
    .maybeSingle();

  let leadPhone = String((lead as { phone?: string | null } | null)?.phone ?? "").trim();
  if (!leadPhone) {
    const { data: capturedPhone } = await admin
      .from("atendimento_captured_fields")
      .select("field_value")
      .eq("lead_id", String(conversation.lead_id))
      .eq("field_name", "phone")
      .not("field_value", "is", null)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    leadPhone = String((capturedPhone as { field_value?: string | null } | null)?.field_value ?? "").trim();

    if (leadPhone) {
      await admin
        .from("atendimento_leads")
        .update({
          phone: leadPhone,
          updated_at: nowIso,
        })
        .eq("id", String(conversation.lead_id));
    }
  }

  const activePresenceCount = await getAtendimentoActivePresenceCount(conversationId);
  if (activePresenceCount === 0) {
    const { data: notificationLease } = await admin
      .from("atendimento_conversations")
      .update({
        offline_message_notification_sent: true,
        offline_message_notification_sent_at: nowIso,
      })
      .eq("id", conversationId)
      .eq("offline_message_notification_sent", false)
      .select("id")
      .maybeSingle();

    if (notificationLease?.id) {
      await appendHistoryEvent({
        leadId: String(conversation.lead_id),
        conversationId,
        eventType: "offline_message_notification_suppressed",
        title: "Notificação offline de nova mensagem desativada (removida)",
        details: {
          reason: "notificacao_manual_desativada_pedido",
          public_slug: String((conversation as { public_slug?: string | null }).public_slug ?? ""),
          lead_phone_captured: Boolean(leadPhone),
        },
        actorType: "system",
      });
    }
  }

  return Response.json({ ok: true, message: data });
}
