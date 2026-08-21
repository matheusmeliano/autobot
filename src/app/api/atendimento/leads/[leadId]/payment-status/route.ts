import {
  appendHistoryEvent,
  confirmLeadRecurringPayment,
  rejectLeadRecurringPayment,
  requireAtendimentoUser,
  syncConversationPreview,
} from "@/lib/atendimento/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function toErrorMessage(raw: unknown, fallback = "Erro desconhecido."): string {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "string") {
    const s = raw.trim();
    return s || fallback;
  }
  if (raw instanceof Error) {
    const m = raw.message?.trim();
    return m || fallback;
  }
  if (typeof raw === "object") {
    const any = raw as Record<string, unknown>;
    const candidates = [any.message, any.error, any.error_message, any.msg, any.detail];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw) || fallback;
    }
  }
  return String(raw) || fallback;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ leadId: string }> },
) {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok || !auth.user) {
      return Response.json({ ok: false, error: "Não autorizado." }, { status: 401 });
    }
    const email = auth.user.email || null;
    const params = await ctx.params;
    const leadId = String(params.leadId ?? "").trim();
    if (!leadId) {
      return Response.json({ ok: false, error: "Lead não informado." }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    const action = String(body?.action ?? "").trim().toLowerCase();
    const reason = body && typeof (body as any).reason === "string" ? String((body as any).reason).trim() : null;
    if (action !== "confirm" && action !== "reject") {
      return Response.json(
        { ok: false, error: "Ação inválida. Use 'confirm' ou 'reject'." },
        { status: 400 },
      );
    }
    const admin = createSupabaseAdminClient();
    let result: any;
    if (action === "confirm") {
      result = await confirmLeadRecurringPayment({
        admin,
        leadId,
        actorType: "attendant",
        attendantEmail: email || null,
      });
    } else {
      result = await rejectLeadRecurringPayment({
        admin,
        leadId,
        reason,
        actorType: "attendant",
        attendantEmail: email || null,
      });
    }
    if (!result?.ok) {
      const blocked = Boolean(result?.blocked);
      return Response.json(
        { ok: false, blocked, error: toErrorMessage(result?.error, "Falha ao atualizar pagamento.") },
        { status: blocked ? 409 : 500 },
      );
    }
    try {
      const { data: conversations } = await admin
        .from("atendimento_conversations")
        .select("id, lead_id")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1);
      const conversation = conversations?.[0] ?? null;
      if (conversation?.id) {
        try {
          await (syncConversationPreview as any)({
            conversationId: String(conversation.id),
          });
        } catch {}
      }
    } catch {}
    try {
      await appendHistoryEvent({
        leadId,
        eventType: action === "confirm"
          ? "attendant_clicked_payment_sim"
          : "attendant_clicked_payment_nao",
        title: action === "confirm"
          ? "Atendente: Pagamento confirmado (Sim)"
          : "Atendente: Pagamento NÃO realizado (Não)",
        details: {
          attendant_email: email || null,
          reason,
          result: result ?? null,
        },
        actorType: "attendant",
      });
    } catch {}
    return Response.json({ ok: true, ...(result || {}) });
  } catch (e) {
    return Response.json(
      { ok: false, error: toErrorMessage(e, "Falha ao processar pagamento.") },
      { status: 500 },
    );
  }
}
