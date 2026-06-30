import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { isAtendimentoOnlyAccessScope, normalizeAccessScope } from "@/lib/auth/access";

export async function GET(_: Request, context: { params: Promise<{ leadId: string }> }) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { leadId } = await context.params;
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
    return Response.json({ ok: false, error: leadError.message }, { status: 500 });
  }
  if (eventsError) {
    return Response.json({ ok: false, error: eventsError.message }, { status: 500 });
  }
  if (!lead?.id) {
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

  return Response.json({
    ok: true,
    lead: {
      ...(lead as any),
      conversation: conversation ?? null,
    },
    events: (events ?? []) as any[],
  });
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
  if (authUserId) {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("access_scope")
      .eq("user_id", authUserId)
      .maybeSingle();

    if (profileError) {
      return Response.json({ ok: false, error: profileError.message }, { status: 500 });
    }

    if (isAtendimentoOnlyAccessScope(normalizeAccessScope((profile as any)?.access_scope))) {
      const { error: deleteAuthUserError } = await admin.auth.admin.deleteUser(authUserId);
      if (deleteAuthUserError) {
        return Response.json({ ok: false, error: deleteAuthUserError.message }, { status: 500 });
      }
    }
  }

  const { data: conversations, error: conversationsError } = await admin
    .from("atendimento_conversations")
    .select("id")
    .eq("lead_id", leadId);

  if (conversationsError) {
    return Response.json({ ok: false, error: conversationsError.message }, { status: 500 });
  }

  const conversationIds = (conversations ?? [])
    .map((row) => String((row as { id?: string | null }).id ?? "").trim())
    .filter(Boolean);

  if (conversationIds.length > 0) {
    const { error: messagesError } = await admin
      .from("atendimento_messages")
      .delete()
      .in("conversation_id", conversationIds);

    if (messagesError) {
      return Response.json({ ok: false, error: messagesError.message }, { status: 500 });
    }
  }

  const { error: eventsError } = await admin.from("atendimento_history_events").delete().eq("lead_id", leadId);
  if (eventsError) {
    return Response.json({ ok: false, error: eventsError.message }, { status: 500 });
  }

  const { error: capturedFieldsError } = await admin.from("atendimento_captured_fields").delete().eq("lead_id", leadId);
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

  return Response.json({ ok: true });
}
