import { appendHistoryEvent, requireAtendimentoUser } from "@/lib/atendimento/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function isExperimentalClassBookingsTableUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .*atendimento_experimental_class_bookings.*does not exist/i.test(message) ||
    /could not find the table .*atendimento_experimental_class_bookings.* in the schema cache/i.test(message)
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
    .select("id, lead_id, conversation_id, status, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_timezone, professor_timezone")
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
      .select("id, lead_id, conversation_id, status, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, lead_timezone, professor_timezone, created_at")
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
          String(row?.professor_start_at ?? "").trim() === String(payload.professorStartAt ?? "").trim();
        const sameConversation =
          String(row?.conversation_id ?? "").trim() &&
          String(row?.conversation_id ?? "").trim() === String(payload.conversationId ?? "").trim();
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

    const { data: updatedBooking, error: updateError } = await admin
      .from("atendimento_experimental_class_bookings")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", String((resolvedBooking as any).id ?? ""))
      .eq("status", "scheduled")
      .select("id, lead_id, conversation_id, status, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, created_at")
      .maybeSingle();

    if (updateError) {
      return Response.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    if (!updatedBooking) {
      return Response.json({ ok: false, error: "booking_not_cancelled" }, { status: 409 });
    }

    await appendHistoryEvent({
      leadId: String((updatedBooking as any).lead_id ?? ""),
      conversationId: String((updatedBooking as any).conversation_id ?? ""),
      eventType: "experimental_class_cancelled",
      title: "Agendamento cancelado manualmente",
      details: {
        booking_id: String((updatedBooking as any).id ?? ""),
        status: "cancelled",
        professor_timezone: String((updatedBooking as any).professor_timezone ?? ""),
        lead_timezone: String((updatedBooking as any).lead_timezone ?? ""),
        professor_date: String((updatedBooking as any).professor_date ?? ""),
        professor_time: String((updatedBooking as any).professor_time ?? ""),
        professor_start_at: String((updatedBooking as any).professor_start_at ?? ""),
        lead_date: String((updatedBooking as any).lead_date ?? ""),
        lead_time: String((updatedBooking as any).lead_time ?? ""),
        lead_start_at: String((updatedBooking as any).lead_start_at ?? ""),
      },
      actorType: "attendant",
      actorEmail: auth.user.email,
    });

    return Response.json({
      ok: true,
      booking: {
        ...(updatedBooking as Record<string, unknown>),
        source: "table",
      },
    });
  }

  if (!payload?.leadId) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  await appendHistoryEvent({
    leadId: String(payload.leadId ?? ""),
    conversationId: String(payload.conversationId ?? ""),
    eventType: "experimental_class_cancelled",
    title: "Agendamento cancelado manualmente",
    details: {
      booking_id: normalizedBookingId,
      status: "cancelled",
      professor_timezone: String(payload.professorTimeZone ?? ""),
      lead_timezone: String(payload.leadTimeZone ?? ""),
      professor_date: String(payload.professorDate ?? ""),
      professor_time: String(payload.professorTime ?? ""),
      professor_start_at: String(payload.professorStartAt ?? ""),
      lead_date: String(payload.leadDate ?? ""),
      lead_time: String(payload.leadTime ?? ""),
      lead_start_at: String(payload.professorStartAt ?? ""),
    },
    actorType: "attendant",
    actorEmail: auth.user.email,
  });

  return Response.json({
    ok: true,
    booking: {
      id: normalizedBookingId,
      lead_id: String(payload.leadId ?? ""),
      conversation_id: String(payload.conversationId ?? ""),
      status: "cancelled",
      professor_timezone: String(payload.professorTimeZone ?? ""),
      lead_timezone: String(payload.leadTimeZone ?? ""),
      professor_date: String(payload.professorDate ?? ""),
      professor_time: String(payload.professorTime ?? ""),
      professor_start_at: String(payload.professorStartAt ?? ""),
      lead_date: String(payload.leadDate ?? ""),
      lead_time: String(payload.leadTime ?? ""),
      lead_start_at: String(payload.professorStartAt ?? ""),
      created_at: new Date().toISOString(),
      source: "history",
    },
  });
}
