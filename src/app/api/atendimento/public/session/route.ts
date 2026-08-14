import {
  createAuthenticatedLeadSession,
  ensureAtendimentoPublicLink,
  ensureInitialBotConversationFlow,
  findLeadByPhone,
  requireAuthenticatedAtendimentoParticipant,
} from "@/lib/atendimento/server";
import { ATENDIMENTO_PUBLIC_LINK_SLUG } from "@/lib/atendimento/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { initialBotMessages } from "@/lib/atendimento/bot";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const slug = String(body?.slug ?? "").trim();
  const telefone = String(body?.telefone ?? "").replace(/\D/g, "").trim();
  const origin = req.headers.get("origin");

  try {
    const admin = createSupabaseAdminClient();
    const publicLink = await ensureAtendimentoPublicLink(origin || undefined);
    const publicSlug = slug || String(publicLink.slug ?? ATENDIMENTO_PUBLIC_LINK_SLUG);
    if (publicSlug !== ATENDIMENTO_PUBLIC_LINK_SLUG) {
      return Response.json({ ok: false, error: "Link de atendimento inválido." }, { status: 400 });
    }

    let lead: any = null;
    let conversation: any = null;
    const auth = await requireAuthenticatedAtendimentoParticipant();

    if (auth.ok && auth.user?.id) {
      const session = await createAuthenticatedLeadSession({
        origin,
        slug,
        userId: auth.user.id,
        email: auth.profile?.email ?? auth.user.email ?? null,
        name: auth.profile?.nome ?? null,
      });
      lead = session.lead;
      conversation = session.conversation;
    } else if (telefone && telefone.length >= 10) {
      lead = await findLeadByPhone({ phone: telefone });
      if (!lead?.id) {
        return Response.json(
          { ok: false, error: "Cadastro não encontrado. Refaça o cadastro pelo link da matrícula." },
          { status: 404 },
        );
      }
      const { data: existingConversation } = await admin
        .from("atendimento_conversations")
        .select("*")
        .eq("lead_id", String(lead.id))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingConversation?.id) {
        conversation = existingConversation;
      } else {
        const { data: createdConversation } = await admin
          .from("atendimento_conversations")
          .insert({
            lead_id: String(lead.id),
            public_link_id: String(publicLink.id ?? ""),
            channel: "web",
            public_slug:
              typeof globalThis !== "undefined" && "crypto" in globalThis && typeof crypto.randomUUID === "function"
                ? crypto.randomUUID().replace(/-/g, "").slice(0, 32)
                : Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
            bot_enabled: true,
          })
          .select("*")
          .maybeSingle();
        conversation = createdConversation;
      }
      if (!conversation?.id) {
        throw new Error("Não foi possível preparar a conversa.");
      }
    } else {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    await ensureInitialBotConversationFlow({
      leadId: String(lead.id),
      conversationId: String(conversation.id),
    });
    const { data: initialMessages } = await admin
      .from("atendimento_messages")
      .select("*")
      .eq("conversation_id", String(conversation.id))
      .order("created_at", { ascending: true });

    return Response.json({
      ok: true,
      session: {
        lead,
        conversation,
        publicLink: {
          slug: publicSlug,
          public_url: publicLink.public_url || null,
        },
        initial_total: initialBotMessages().length,
        messages: (initialMessages ?? []) as any[],
      },
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: String(error?.message ?? "Falha ao iniciar atendimento.") }, { status: 400 });
  }
}
