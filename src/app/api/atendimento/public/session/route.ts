import {
  createAuthenticatedLeadSession,
  ensureInitialBotConversationFlow,
  requireAuthenticatedAtendimentoParticipant,
} from "@/lib/atendimento/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { initialBotMessages } from "@/lib/atendimento/bot";
import fs from "node:fs";

// #region debug-point A2:bootstrap-bot-duplicate
const __dbgBotEnvPath = ".dbg/bot-duplicate-message.env";
const __dbgBotEnvRaw = fs.existsSync(__dbgBotEnvPath) ? fs.readFileSync(__dbgBotEnvPath, "utf8") : "";
const __dbgBotMap = Object.fromEntries(
  __dbgBotEnvRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("=");
      return idx >= 0 ? [line.slice(0, idx), line.slice(idx + 1)] : [line, ""];
    }),
);
const __dbgBotUrl = __dbgBotMap.DEBUG_SERVER_URL;
const __dbgBotSession = __dbgBotMap.DEBUG_SESSION_ID;
const __dbgBot = (traceId: string, hypothesisId: string, msg: string, data: Record<string, unknown>) => {
  if (!__dbgBotUrl || !__dbgBotSession) return;
  fetch(__dbgBotUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: __dbgBotSession,
      runId: "post-fix",
      hypothesisId,
      traceId,
      location: "src/app/api/atendimento/public/session/route.ts",
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

export async function POST(req: Request) {
  const traceId = `public-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = await req.json().catch(() => null);
  const slug = String(body?.slug ?? "").trim();
  const origin = req.headers.get("origin");

  try {
    // #region debug-point A2:session-start
    __dbgBot(traceId, "A", "[DEBUG] public_session_start", { slug, origin });
    // #endregion
    const auth = await requireAuthenticatedAtendimentoParticipant();
    if (!auth.ok || !auth.user?.id) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // #region debug-point A2:session-auth-ok
    __dbgBot(traceId, "A", "[DEBUG] public_session_auth_ok", { userId: String(auth.user.id) });
    // #endregion
    const session = await createAuthenticatedLeadSession({
      origin,
      slug,
      userId: auth.user.id,
      email: auth.profile?.email ?? auth.user.email ?? null,
      name: auth.profile?.nome ?? null,
    });
    // #region debug-point A2:session-created
    __dbgBot(traceId, "A", "[DEBUG] public_session_created", {
      leadId: String(session.lead.id),
      conversationId: String(session.conversation.id),
      publicSlug: String(session.publicLink?.slug ?? ""),
    });
    // #endregion
    await ensureInitialBotConversationFlow({
      leadId: String(session.lead.id),
      conversationId: String(session.conversation.id),
    });
    // #region debug-point A2:session-ensure-initial-done
    __dbgBot(traceId, "A", "[DEBUG] public_session_ensure_initial_done", {
      conversationId: String(session.conversation.id),
    });
    // #endregion
    const admin = createSupabaseAdminClient();
    const { data: initialMessages } = await admin
      .from("atendimento_messages")
      .select("*")
      .eq("conversation_id", String(session.conversation.id))
      .order("created_at", { ascending: true });

    const messages = (initialMessages ?? []) as any[];
    const botTexts = messages
      .filter((m) => m?.sender_role === "bot" && String(m?.content_text ?? "").trim())
      .map((m) => String(m?.content_text ?? "").trim());
    // #region debug-point A2:session-messages-summary
    __dbgBot(traceId, "A", "[DEBUG] public_session_messages_summary", {
      conversationId: String(session.conversation.id),
      totalCount: messages.length,
      botCount: botTexts.length,
      botUniqueCount: new Set(botTexts).size,
    });
    // #endregion

    return Response.json({
      ok: true,
      session: {
        lead: session.lead,
        conversation: session.conversation,
        publicLink: session.publicLink,
        initial_total: initialBotMessages().length,
        messages,
      },
    });
  } catch (error: any) {
    // #region debug-point A2:session-error
    __dbgBot(traceId, "A", "[DEBUG] public_session_error", { error: String(error?.message ?? error ?? "") });
    // #endregion
    return Response.json({ ok: false, error: String(error?.message ?? "Falha ao iniciar atendimento.") }, { status: 400 });
  }
}
