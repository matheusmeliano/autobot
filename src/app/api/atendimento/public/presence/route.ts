import {
  getAuthenticatedAtendimentoConversationAccess,
  removeAtendimentoPresenceSession,
  upsertAtendimentoPresenceSession,
} from "@/lib/atendimento/server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const publicSlug = String(body?.public_slug ?? "").trim();
  const sessionId = String(body?.session_id ?? "").trim();
  const state = String(body?.state ?? "").trim().toLowerCase();

  if (!publicSlug || !sessionId || !["visible", "hidden"].includes(state)) {
    return Response.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const access = await getAuthenticatedAtendimentoConversationAccess(publicSlug);
  if (!access.ok) {
    return Response.json({ ok: false, error: access.error }, { status: access.status });
  }

  if (state === "visible") {
    await upsertAtendimentoPresenceSession({
      sessionId,
      conversationId: String(access.conversation.id),
      leadId: String(access.lead.id),
      publicSlug,
    });
    return Response.json({ ok: true, state: "visible" });
  }

  await removeAtendimentoPresenceSession(sessionId);
  return Response.json({ ok: true, state: "hidden" });
}
