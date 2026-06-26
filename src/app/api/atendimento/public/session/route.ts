import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { initialBotMessages } from "@/lib/atendimento/bot";
import { appendHistoryEvent, createPublicLeadSession, syncConversationPreview } from "@/lib/atendimento/server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const slug = String(body?.slug ?? "").trim();
  const origin = req.headers.get("origin");

  try {
    const session = await createPublicLeadSession({ origin, slug });
    const admin = createSupabaseAdminClient();
    const nowIso = new Date().toISOString();
    const botMessages = initialBotMessages().map((content) => ({
      conversation_id: String(session.conversation.id),
      sender_role: "bot",
      content_text: content,
      media_type: "text",
      status: "lida",
      sent_at: nowIso,
      delivered_at: nowIso,
      read_at: nowIso,
    }));

    await admin.from("atendimento_messages").insert(botMessages);
    await admin
      .from("atendimento_leads")
      .update({
        status: "em_atendimento",
        funnel_stage: "aula_experimental_convidada",
        last_interaction_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", String(session.lead.id));
    await syncConversationPreview({
      conversationId: String(session.conversation.id),
      contentText: botMessages[botMessages.length - 1]?.content_text ?? "",
      createdAt: nowIso,
    });
    await appendHistoryEvent({
      leadId: String(session.lead.id),
      conversationId: String(session.conversation.id),
      eventType: "stage_changed",
      title: "Fluxo inicial do bot iniciado",
      details: { funnel_stage: "aula_experimental_convidada" },
      actorType: "bot",
    });

    return Response.json({
      ok: true,
      session: {
        lead: session.lead,
        conversation: session.conversation,
        publicLink: session.publicLink,
      },
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: String(error?.message ?? "Falha ao iniciar atendimento.") }, { status: 400 });
  }
}
