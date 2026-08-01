import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { isAtendimentoOnlyAccessScope, normalizeAccessScope } from "@/lib/auth/access";
import { z } from "zod";

function isExperimentalClassBookingsTableUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .*atendimento_experimental_class_bookings.*does not exist/i.test(message) ||
    /could not find the table .*atendimento_experimental_class_bookings.* in the schema cache/i.test(
      message,
    )
  );
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ leadId: string }> }) {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { leadId } = await context.params;
    const url = new URL(request.url);
    const skipEvents = url.searchParams.get("skipEvents") !== "0";
    const admin = createSupabaseAdminClient();

    const leadPromise = admin
      .from("atendimento_leads")
      .select("*")
      .eq("id", leadId)
      .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
      .maybeSingle();
    const eventsPromise = skipEvents
      ? Promise.resolve({ data: [] as any[], error: null as any })
      : admin
          .from("atendimento_history_events")
          .select("*")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(100);
    const [{ data: lead, error: leadError }, { data: events, error: eventsError }] = await Promise.all([
      leadPromise,
      eventsPromise,
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
      .select("id")
      .eq("lead_id", leadId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (conversationError) {
      return Response.json({ ok: false, error: conversationError.message }, { status: 500 });
    }

    return Response.json({
      ok: true,
      lead: {
        ...(lead as any),
        is_new_for_attendant: (lead as any)?.is_new_for_attendant ?? false,
        conversation: conversation ?? null,
      },
      events: (events ?? []) as any[],
    });
  } catch (error) {
    return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ leadId: string }> }) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { leadId } = await context.params;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch (_) {
    return Response.json({ ok: false, error: "body_invalido" }, { status: 400 });
  }

  const schema = z.object({
    full_name: z.string().trim().max(160).nullable().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "dados_invalidos" }, { status: 400 });
  }

  const fullNameRaw = parsed.data.full_name;
  const safeFullName =
    fullNameRaw === undefined
      ? undefined
      : fullNameRaw === null
        ? null
        : String(fullNameRaw).trim() || null;

  const admin = createSupabaseAdminClient();
  const updateData: Record<string, unknown> = {};
  if (safeFullName !== undefined) updateData.full_name = safeFullName;

  if (Object.keys(updateData).length === 0) {
    return Response.json({ ok: true, lead: null });
  }

  const { data: updated, error } = await admin
    .from("atendimento_leads")
    .update(updateData)
    .eq("id", leadId)
    .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
    .select("id, full_name, updated_at")
    .maybeSingle();

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!updated?.id) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  return Response.json({
    ok: true,
    lead: {
      id: String(updated.id ?? ""),
      full_name: String((updated as any).full_name ?? "").trim() || null,
      updated_at: String((updated as any).updated_at ?? new Date().toISOString()),
    },
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

  {
    const bookingsDelete = await admin
      .from("atendimento_experimental_class_bookings")
      .delete()
      .eq("lead_id", leadId);
    if (bookingsDelete.error && !isExperimentalClassBookingsTableUnavailable(bookingsDelete.error)) {
      return Response.json({ ok: false, error: bookingsDelete.error.message }, { status: 500 });
    }
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
