import { botReplyForLead, extractLeadDataFromMessage, getNextMissingField } from "@/lib/atendimento/bot";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendHistoryEvent, ensureInitialBotConversationFlow, syncConversationPreview } from "@/lib/atendimento/server";

async function upsertCapturedFields(params: {
  leadId: string;
  sourceMessageId: string;
  values: Record<string, string>;
}) {
  const admin = createSupabaseAdminClient();
  const entries = Object.entries(params.values).filter(([, value]) => String(value).trim());
  if (!entries.length) return;

  for (const [fieldName, fieldValue] of entries) {
    const { data: existing } = await admin
      .from("atendimento_captured_fields")
      .select("id")
      .eq("lead_id", params.leadId)
      .eq("field_name", fieldName)
      .maybeSingle();

    if (existing?.id) {
      await admin
        .from("atendimento_captured_fields")
        .update({
          field_value: fieldValue,
          source_message_id: params.sourceMessageId,
          confidence: 0.92,
          updated_at: new Date().toISOString(),
        })
        .eq("id", String(existing.id));
    } else {
      await admin.from("atendimento_captured_fields").insert({
        lead_id: params.leadId,
        field_name: fieldName,
        field_value: fieldValue,
        source_message_id: params.sourceMessageId,
        confidence: 0.92,
      });
    }
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const publicSlug = String(searchParams.get("public_slug") ?? "").trim();
  if (!publicSlug) {
    return Response.json({ ok: false, error: "missing_public_slug" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: conversation } = await admin
    .from("atendimento_conversations")
    .select("id, lead_id")
    .eq("public_slug", publicSlug)
    .maybeSingle();

  if (!conversation?.id) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  await ensureInitialBotConversationFlow({
    leadId: String(conversation.lead_id),
    conversationId: String(conversation.id),
  });

  const { data, error } = await admin
    .from("atendimento_messages")
    .select("*")
    .eq("conversation_id", String(conversation.id))
    .order("created_at", { ascending: true });

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  await admin
    .from("atendimento_messages")
    .update({ status: "lida", read_at: new Date().toISOString() })
    .eq("conversation_id", String(conversation.id))
    .in("sender_role", ["bot", "attendant"])
    .neq("status", "lida");

  return Response.json({ ok: true, messages: (data ?? []) as any[] });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const publicSlug = String(body?.public_slug ?? "").trim();
  const contentText = String(body?.content_text ?? "").trim();
  const mediaType = String(body?.media_type ?? "text").trim() || "text";
  const mediaUrl = String(body?.media_url ?? "").trim() || null;
  const mimeType = String(body?.mime_type ?? "").trim() || null;

  if (!publicSlug) {
    return Response.json({ ok: false, error: "missing_public_slug" }, { status: 400 });
  }
  if (!contentText && !mediaUrl) {
    return Response.json({ ok: false, error: "empty_message" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: conversation } = await admin
    .from("atendimento_conversations")
    .select("id, lead_id")
    .eq("public_slug", publicSlug)
    .maybeSingle();

  if (!conversation?.id) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const { data: lead } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("id", String(conversation.lead_id))
    .maybeSingle();

  if (!lead?.id) {
    return Response.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const { data: inbound, error: inboundError } = await admin
    .from("atendimento_messages")
    .insert({
      conversation_id: String(conversation.id),
      sender_role: "lead",
      content_text: contentText || null,
      media_type: mediaType,
      media_url: mediaUrl,
      mime_type: mimeType,
      status: "recebida",
      sent_at: nowIso,
      delivered_at: nowIso,
    })
    .select("*")
    .maybeSingle();

  if (inboundError || !inbound?.id) {
    return Response.json({ ok: false, error: inboundError?.message ?? "message_error" }, { status: 500 });
  }

  const captured = extractLeadDataFromMessage(contentText);
  const nextLead = {
    ...lead,
    ...captured,
  };
  const nextMissingField = getNextMissingField(nextLead as any);
  const botResponse = botReplyForLead({ lead: nextLead as any, messageText: contentText });
  const nextStage = nextMissingField ? botResponse.stage : "pre_cadastro_concluido";
  const nextStatus = nextMissingField ? botResponse.status : "matricula_pendente";

  await admin
    .from("atendimento_leads")
    .update({
      ...captured,
      status: nextStatus,
      funnel_stage: nextStage,
      unread_count: Number(lead.unread_count ?? 0) + 1,
      last_interaction_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", String(lead.id));

  await upsertCapturedFields({
    leadId: String(lead.id),
    sourceMessageId: String(inbound.id),
    values: captured as Record<string, string>,
  });

  await syncConversationPreview({
    conversationId: String(conversation.id),
    contentText: contentText || `[${mediaType}]`,
    createdAt: nowIso,
  });

  await appendHistoryEvent({
    leadId: String(lead.id),
    conversationId: String(conversation.id),
    eventType: "message_received",
    title: "Mensagem recebida do lead",
    details: { content_text: contentText || null, media_type: mediaType },
    actorType: "lead",
  });

  if (Object.keys(captured).length > 0) {
    await appendHistoryEvent({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
      eventType: "data_captured",
      title: "Dados capturados automaticamente",
      details: captured,
      actorType: "system",
    });
  }

  const { data: outbound } = await admin
    .from("atendimento_messages")
    .insert({
      conversation_id: String(conversation.id),
      sender_role: "bot",
      content_text: botResponse.message,
      media_type: "text",
      status: "entregue",
      sent_at: nowIso,
      delivered_at: nowIso,
    })
    .select("*")
    .maybeSingle();

  await syncConversationPreview({
    conversationId: String(conversation.id),
    contentText: botResponse.message,
    createdAt: nowIso,
  });
  await appendHistoryEvent({
    leadId: String(lead.id),
    conversationId: String(conversation.id),
    eventType: "stage_changed",
    title: "Etapa do funil atualizada automaticamente",
    details: { status: nextStatus, funnel_stage: nextStage },
    actorType: "bot",
  });

  return Response.json({ ok: true, inbound, outbound });
}
