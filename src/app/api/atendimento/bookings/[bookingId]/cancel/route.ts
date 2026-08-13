import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAtendimentoOnlyAccessScope, normalizeAccessScope } from "@/lib/auth/access";

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { bookingId } = await params;
  const normalizedBookingId = String(bookingId ?? "").trim();
  if (!normalizedBookingId) {
    return Response.json({ ok: false, error: "missing_booking_id" }, { status: 400 });
  }

  const payload = (await req.json().catch(() => null)) as
    | {
        leadId?: string | null;
        conversationId?: string | null;
        professorDate?: string | null;
        professorTime?: string | null;
        professorStartAt?: string | null;
        leadDate?: string | null;
        leadTime?: string | null;
        leadTimeZone?: string | null;
        professorTimeZone?: string | null;
      }
    | null;

  const admin = createSupabaseAdminClient();
  const { data: booking, error: bookingError } = await admin
    .from("atendimento_experimental_class_bookings")
    .select(
      "id, lead_id, conversation_id, status, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_timezone, professor_timezone",
    )
    .eq("id", normalizedBookingId)
    .maybeSingle();

  const tableUnavailable = isExperimentalClassBookingsTableUnavailable(bookingError);
  if (bookingError && !tableUnavailable) {
    return Response.json({ ok: false, error: bookingError.message }, { status: 500 });
  }

  let resolvedBooking = booking as Record<string, unknown> | null;

  if (!resolvedBooking && !tableUnavailable && payload?.leadId) {
    const query = admin
      .from("atendimento_experimental_class_bookings")
      .select(
        "id, lead_id, conversation_id, status, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, lead_timezone, professor_timezone, created_at",
      )
      .eq("lead_id", String(payload.leadId))
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10);

    const { data: leadBookings, error: leadBookingsError } = await query;
    if (leadBookingsError && !isExperimentalClassBookingsTableUnavailable(leadBookingsError)) {
      return Response.json({ ok: false, error: leadBookingsError.message }, { status: 500 });
    }

    resolvedBooking =
      ((leadBookings ?? []) as Record<string, unknown>[]).find((row) => {
        const sameProfessorStartAt =
          String(row?.professor_start_at ?? "").trim() &&
          String(row?.professor_start_at ?? "").trim() ===
            String(payload.professorStartAt ?? "").trim();
        const sameConversation =
          String(row?.conversation_id ?? "").trim() &&
          String(row?.conversation_id ?? "").trim() ===
            String(payload.conversationId ?? "").trim();
        return sameProfessorStartAt || sameConversation;
      }) ?? null;
  }

  if (resolvedBooking) {
    const currentStatus = String((resolvedBooking as any)?.status ?? "").trim().toLowerCase();
    if (currentStatus !== "scheduled") {
      return Response.json(
        {
          ok: false,
          error: "only_scheduled_bookings_can_be_cancelled",
          booking: resolvedBooking,
        },
        { status: 409 },
      );
    }
  }

  const resolvedLeadId = String(
    (resolvedBooking as any)?.lead_id ?? payload?.leadId ?? "",
  ).trim();
  if (!resolvedLeadId) {
    return Response.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }

  const { data: lead, error: leadError } = await admin
    .from("atendimento_leads")
    .select("id, auth_user_id")
    .eq("id", resolvedLeadId)
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
    admin.from("atendimento_conversations").select("id").eq("lead_id", resolvedLeadId),
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
    admin.from("atendimento_history_events").delete().eq("lead_id", resolvedLeadId),
    admin.from("atendimento_captured_fields").delete().eq("lead_id", resolvedLeadId),
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
      .eq("lead_id", resolvedLeadId);
    if (
      bookingsDelete.error &&
      !isExperimentalClassBookingsTableUnavailable(bookingsDelete.error)
    ) {
      return Response.json({ ok: false, error: bookingsDelete.error.message }, { status: 500 });
    }
  }

  const { error: conversationsDeleteError } = await admin
    .from("atendimento_conversations")
    .delete()
    .eq("lead_id", resolvedLeadId);
  if (conversationsDeleteError) {
    return Response.json(
      { ok: false, error: conversationsDeleteError.message },
      { status: 500 },
    );
  }

  const { error: leadDeleteError } = await admin
    .from("atendimento_leads")
    .delete()
    .eq("id", resolvedLeadId);
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

  return Response.json({
    ok: true,
    deleted_lead: true,
    lead_id: resolvedLeadId,
    booking: {
      id: normalizedBookingId,
      status: "cancelled",
      lead_id: resolvedLeadId,
    },
  });
}
