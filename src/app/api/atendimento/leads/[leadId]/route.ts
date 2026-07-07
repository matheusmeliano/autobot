import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { isAtendimentoOnlyAccessScope, normalizeAccessScope } from "@/lib/auth/access";

export const runtime = "nodejs";
export const maxDuration = 60;

// #region debug-point A:bootstrap
const __dbgUrl = "http://127.0.0.1:7777/event";
const __dbgSession = "atendimento-lead-detail";
const __dbg = (traceId: string, hypothesisId: string, msg: string, data: Record<string, unknown>) => {
  fetch(__dbgUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: __dbgSession,
      runId: "pre-fix",
      hypothesisId,
      traceId,
      location: "src/app/api/atendimento/leads/[leadId]/route.ts",
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

export async function GET(_: Request, context: { params: Promise<{ leadId: string }> }) {
  const traceId = `lead-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      // #region debug-point B:auth-forbidden
      __dbg(traceId, "B", "[DEBUG] atendimento_lead_detail_route_forbidden", {});
      // #endregion
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { leadId } = await context.params;
    // #region debug-point B:route-start
    __dbg(traceId, "B", "[DEBUG] atendimento_lead_detail_route_start", {
      leadId,
    });
    // #endregion
    const admin = createSupabaseAdminClient();

    const [{ data: lead, error: leadError }, { data: events, error: eventsError }] = await Promise.all([
      admin
        .from("atendimento_leads")
        .select("*")
        .eq("id", leadId)
        .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
        .maybeSingle(),
      admin
        .from("atendimento_history_events")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (leadError) {
      // #region debug-point C:lead-query-error
      __dbg(traceId, "C", "[DEBUG] atendimento_lead_detail_route_lead_error", {
        leadId,
        error: leadError.message,
      });
      // #endregion
      return Response.json({ ok: false, error: leadError.message }, { status: 500 });
    }
    if (eventsError) {
      // #region debug-point C:events-query-error
      __dbg(traceId, "C", "[DEBUG] atendimento_lead_detail_route_events_error", {
        leadId,
        error: eventsError.message,
      });
      // #endregion
      return Response.json({ ok: false, error: eventsError.message }, { status: 500 });
    }
    if (!lead?.id) {
      // #region debug-point D:not-found
      __dbg(traceId, "D", "[DEBUG] atendimento_lead_detail_route_not_found", {
        leadId,
      });
      // #endregion
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const { data: conversation, error: conversationError } = await admin
      .from("atendimento_conversations")
      .select("*")
      .eq("lead_id", leadId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (conversationError) {
      // #region debug-point C:conversation-query-error
      __dbg(traceId, "C", "[DEBUG] atendimento_lead_detail_route_conversation_error", {
        leadId,
        error: conversationError.message,
      });
      // #endregion
      return Response.json({ ok: false, error: conversationError.message }, { status: 500 });
    }

    await admin
      .from("atendimento_leads")
      .update({ unread_count: 0, updated_at: new Date().toISOString() })
      .eq("id", leadId);

    const conversationId = String((conversation as any)?.id ?? "");
    if (conversationId) {
      await admin
        .from("atendimento_messages")
        .update({ status: "lida", read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("sender_role", "lead")
        .is("read_at", null);
    }

    // #region debug-point E:route-success
    __dbg(traceId, "E", "[DEBUG] atendimento_lead_detail_route_success", {
      leadId,
      conversationId,
      eventsCount: Array.isArray(events) ? events.length : 0,
      assignedUserEmail: String((lead as { assigned_user_email?: string | null })?.assigned_user_email ?? ""),
    });
    // #endregion

    return Response.json({
      ok: true,
      lead: {
        ...(lead as any),
        conversation: conversation ?? null,
      },
      events: (events ?? []) as any[],
    });
  } catch (error) {
    // #region debug-point F:unexpected-error
    __dbg(traceId, "F", "[DEBUG] atendimento_lead_detail_route_unexpected_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    // #endregion
    return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ leadId: string }> }) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { leadId } = await context.params;
  const admin = createSupabaseAdminClient();

  const { data: lead, error: leadError } = await admin
    .from("atendimento_leads")
    .select("id, auth_user_id")
    .eq("id", leadId)
    .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
    .maybeSingle();

  if (leadError) {
    return Response.json({ ok: false, error: leadError.message }, { status: 500 });
  }

  if (!lead?.id) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const authUserId = String((lead as { auth_user_id?: string | null }).auth_user_id ?? "").trim();
  const [{ data: conversations, error: conversationsError }, profileResult] = await Promise.all([
    admin
      .from("atendimento_conversations")
      .select("id")
      .eq("lead_id", leadId),
    authUserId
      ? admin
          .from("profiles")
          .select("access_scope")
          .eq("user_id", authUserId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (conversationsError) {
    return Response.json({ ok: false, error: conversationsError.message }, { status: 500 });
  }

  if (profileResult.error) {
    return Response.json({ ok: false, error: profileResult.error.message }, { status: 500 });
  }

  const conversationIds = (conversations ?? [])
    .map((row) => String((row as { id?: string | null }).id ?? "").trim())
    .filter(Boolean);

  const deleteMessagesPromise =
    conversationIds.length > 0
      ? admin
          .from("atendimento_messages")
          .delete()
          .in("conversation_id", conversationIds)
      : Promise.resolve({ error: null });
  const [messagesResult, eventsResult, capturedFieldsResult] = await Promise.all([
    deleteMessagesPromise,
    admin.from("atendimento_history_events").delete().eq("lead_id", leadId),
    admin.from("atendimento_captured_fields").delete().eq("lead_id", leadId),
  ]);

  if (messagesResult.error) {
    return Response.json({ ok: false, error: messagesResult.error.message }, { status: 500 });
  }

  const { error: eventsError } = eventsResult;
  if (eventsError) {
    return Response.json({ ok: false, error: eventsError.message }, { status: 500 });
  }

  const { error: capturedFieldsError } = capturedFieldsResult;
  if (capturedFieldsError) {
    return Response.json({ ok: false, error: capturedFieldsError.message }, { status: 500 });
  }

  const { error: conversationsDeleteError } = await admin
    .from("atendimento_conversations")
    .delete()
    .eq("lead_id", leadId);
  if (conversationsDeleteError) {
    return Response.json({ ok: false, error: conversationsDeleteError.message }, { status: 500 });
  }

  const { error: leadDeleteError } = await admin.from("atendimento_leads").delete().eq("id", leadId);
  if (leadDeleteError) {
    return Response.json({ ok: false, error: leadDeleteError.message }, { status: 500 });
  }

  if (
    authUserId &&
    isAtendimentoOnlyAccessScope(normalizeAccessScope((profileResult.data as any)?.access_scope))
  ) {
    const { error: deleteAuthUserError } = await admin.auth.admin.deleteUser(authUserId);
    if (deleteAuthUserError) {
      return Response.json({ ok: false, error: deleteAuthUserError.message }, { status: 500 });
    }
  }

  return Response.json({ ok: true });
}
