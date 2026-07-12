import { appendHistoryEvent, requireAtendimentoUser } from "@/lib/atendimento/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(
  _req: Request,
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

  const admin = createSupabaseAdminClient();
  const { data: booking, error: bookingError } = await admin
    .from("atendimento_experimental_class_bookings")
    .select("id, lead_id, conversation_id, status, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_timezone, professor_timezone")
    .eq("id", normalizedBookingId)
    .maybeSingle();

  if (bookingError) {
    return Response.json({ ok: false, error: bookingError.message }, { status: 500 });
  }

  if (!booking) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const currentStatus = String((booking as any)?.status ?? "").trim().toLowerCase();
  if (currentStatus !== "scheduled") {
    return Response.json(
      {
        ok: false,
        error: "only_scheduled_bookings_can_be_cancelled",
        booking,
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
    .eq("id", normalizedBookingId)
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

  return Response.json({ ok: true, booking: updatedBooking });
}
