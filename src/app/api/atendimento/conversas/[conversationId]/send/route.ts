import {
  appendHistoryEvent,
  buildOfflineAttendantNotificationMessage,
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
      const leadPhone = String((lead as { phone?: string | null } | null)?.phone ?? "").trim();
      const leadName = String((lead as { full_name?: string | null } | null)?.full_name ?? "").trim() || "Aluno";

      if (leadPhone) {
        const notificationMessage = buildOfflineAttendantNotificationMessage({
          leadName,
          publicSlug: String((conversation as { public_slug?: string | null }).public_slug ?? ""),
        });

        try {
          await sendAtendimentoWhatsAppText({
            phone: leadPhone,
            message: notificationMessage,
          });

          await appendHistoryEvent({
            leadId: String(conversation.lead_id),
            conversationId,
            eventType: "offline_message_notification_sent",
            title: "Notificação enviada para lead offline",
            details: {
              phone: leadPhone,
              public_slug: String((conversation as { public_slug?: string | null }).public_slug ?? ""),
            },
            actorType: "system",
          });
        } catch (notificationError) {
          await admin
            .from("atendimento_conversations")
            .update({
              offline_message_notification_sent: false,
              offline_message_notification_sent_at: null,
            })
            .eq("id", conversationId);

          await appendHistoryEvent({
            leadId: String(conversation.lead_id),
            conversationId,
            eventType: "offline_message_notification_failed",
            title: "Falha ao notificar lead offline",
            details: {
              phone: leadPhone,
              error: notificationError instanceof Error ? notificationError.message : String(notificationError),
            },
            actorType: "system",
          });
        }
      } else {
        await appendHistoryEvent({
          leadId: String(conversation.lead_id),
          conversationId,
          eventType: "offline_message_notification_skipped",
          title: "Notificação offline ignorada por falta de telefone",
          details: {
            public_slug: String((conversation as { public_slug?: string | null }).public_slug ?? ""),
          },
          actorType: "system",
        });
      }
    }
  }

  return Response.json({ ok: true, message: data });
}
