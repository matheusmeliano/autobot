import { createPublicLeadSession, ensureInitialBotConversationFlow } from "@/lib/atendimento/server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const slug = String(body?.slug ?? "").trim();
  const origin = req.headers.get("origin");

  try {
    const session = await createPublicLeadSession({ origin, slug });
    await ensureInitialBotConversationFlow({
      leadId: String(session.lead.id),
      conversationId: String(session.conversation.id),
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
