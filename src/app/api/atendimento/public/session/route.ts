import {
  createAuthenticatedLeadSession,
  ensureInitialBotConversationFlow,
  requireAuthenticatedAtendimentoParticipant,
} from "@/lib/atendimento/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { initialBotMessages } from "@/lib/atendimento/bot";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const slug = String(body?.slug ?? "").trim();
  const origin = req.headers.get("origin");

  try {
    const auth = await requireAuthenticatedAtendimentoParticipant();
    if (!auth.ok || !auth.user?.id) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const session = await createAuthenticatedLeadSession({
      origin,
      slug,
      userId: auth.user.id,
      email: auth.profile?.email ?? auth.user.email ?? null,
      name: auth.profile?.nome ?? null,
    });
    await ensureInitialBotConversationFlow({
      leadId: String(session.lead.id),
      conversationId: String(session.conversation.id),
    });
    const admin = createSupabaseAdminClient();
    const { data: initialMessages } = await admin
      .from("atendimento_messages")
      .select("*")
      .eq("conversation_id", String(session.conversation.id))
      .order("created_at", { ascending: true });

    return Response.json({
      ok: true,
      session: {
        lead: session.lead,
        conversation: session.conversation,
        publicLink: session.publicLink,
        initial_total: initialBotMessages().length,
        messages: (initialMessages ?? []) as any[],
      },
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: String(error?.message ?? "Falha ao iniciar atendimento.") }, { status: 400 });
  }
}
