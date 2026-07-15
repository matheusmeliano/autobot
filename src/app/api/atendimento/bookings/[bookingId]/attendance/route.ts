import {
  appendHistoryEvent,
  requireAtendimentoUser,
  sendAtendimentoWhatsAppText,
} from "@/lib/atendimento/server";
import { buildExperimentalClassPostAttendanceWhatsAppMessage } from "@/lib/atendimento/experimentalClass";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function getLeadFirstName(name: string | null | undefined) {
  const parts = String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
  return parts[0] ?? "Aluno";
}

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

function isExperimentalClassBookingsLessonLinkColumnUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /column .*lesson_link.* does not exist/i.test(message) ||
    /could not find the 'lesson_link' column of 'atendimento_experimental_class_bookings' in the schema cache/i.test(
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
        attendance?: "attended" | "no_show" | null;
        leadId?: string | null;
        conversationId?: string | null;
      }
    | null;

  const attendance = String(payload?.attendance ?? "").trim().toLowerCase();
  if (attendance !== "attended" && attendance !== "no_show") {
    return Response.json({ ok: false, error: "invalid_attendance" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const bookingWithLessonLinkResult = await admin
    .from("atendimento_experimental_class_bookings")
    .select(
      "id, lead_id, conversation_id, status, lesson_link, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, created_at",
    )
    .eq("id", normalizedBookingId)
    .maybeSingle();

  let resolvedBooking: Record<string, unknown> | null = null;

  if (
    bookingWithLessonLinkResult.error &&
    isExperimentalClassBookingsLessonLinkColumnUnavailable(bookingWithLessonLinkResult.error)
  ) {
    const bookingWithoutLessonLinkResult = await admin
      .from("atendimento_experimental_class_bookings")
      .select(
        "id, lead_id, conversation_id, status, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, created_at",
      )
      .eq("id", normalizedBookingId)
      .maybeSingle();

    if (bookingWithoutLessonLinkResult.error && !isExperimentalClassBookingsTableUnavailable(bookingWithoutLessonLinkResult.error)) {
      return Response.json({ ok: false, error: bookingWithoutLessonLinkResult.error.message }, { status: 500 });
    }

    resolvedBooking = (bookingWithoutLessonLinkResult.data as Record<string, unknown> | null) ?? null;
  } else {
    if (bookingWithLessonLinkResult.error && !isExperimentalClassBookingsTableUnavailable(bookingWithLessonLinkResult.error)) {
      return Response.json({ ok: false, error: bookingWithLessonLinkResult.error.message }, { status: 500 });
    }

    resolvedBooking = (bookingWithLessonLinkResult.data as Record<string, unknown> | null) ?? null;
  }
  const leadId = String((resolvedBooking as any)?.lead_id ?? payload?.leadId ?? "").trim();
  const conversationId = String((resolvedBooking as any)?.conversation_id ?? payload?.conversationId ?? "").trim() || null;

  if (!leadId) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const { data: lead, error: leadError } = await admin
    .from("atendimento_leads")
    .select("id, full_name, phone")
    .eq("id", leadId)
    .maybeSingle();

  if (leadError) {
    return Response.json({ ok: false, error: leadError.message }, { status: 500 });
  }

  const leadName = String((lead as any)?.full_name ?? "").trim();
  const leadPhone = String((lead as any)?.phone ?? "").trim();
  const responseBooking = {
    ...(resolvedBooking ?? {}),
    id: String((resolvedBooking as any)?.id ?? normalizedBookingId),
    lead_id: leadId,
    conversation_id: conversationId,
    lesson_link: String((resolvedBooking as any)?.lesson_link ?? "").trim() || null,
    attendance_status: attendance,
    attendance_checked_at: new Date().toISOString(),
  };

  if (attendance === "attended") {
    if (!leadPhone) {
      return Response.json({ ok: false, error: "lead_phone_missing" }, { status: 400 });
    }

    try {
      await sendAtendimentoWhatsAppText({
        phone: leadPhone,
        message: buildExperimentalClassPostAttendanceWhatsAppMessage(getLeadFirstName(leadName)),
      });
    } catch (error) {
      await appendHistoryEvent({
        leadId,
        conversationId,
        eventType: "experimental_class_attendance_confirmation_message_failed",
        title: "Falha ao enviar a mensagem de continuidade apos o comparecimento na aula experimental",
        details: {
          booking_id: normalizedBookingId,
          phone: leadPhone,
          lesson_link: String((resolvedBooking as any)?.lesson_link ?? "").trim() || null,
          error: error instanceof Error ? error.message : String(error),
        },
        actorType: "system",
      });

      return Response.json(
        { ok: false, error: error instanceof Error ? error.message : "attendance_confirmation_message_failed" },
        { status: 500 },
      );
    }

    await appendHistoryEvent({
      leadId,
      conversationId,
      eventType: "experimental_class_attendance_confirmed",
      title: "Comparecimento da aula experimental confirmado manualmente",
      details: {
        booking_id: normalizedBookingId,
        lesson_link: String((resolvedBooking as any)?.lesson_link ?? "").trim() || null,
        phone: leadPhone,
      },
      actorType: "attendant",
      actorEmail: auth.user.email,
    });

    await appendHistoryEvent({
      leadId,
      conversationId,
      eventType: "experimental_class_attendance_confirmation_message_sent",
      title: "Mensagem de continuidade enviada ao aluno apos o comparecimento na aula experimental",
      details: {
        booking_id: normalizedBookingId,
        phone: leadPhone,
      },
      actorType: "system",
    });
  } else {
    await appendHistoryEvent({
      leadId,
      conversationId,
      eventType: "experimental_class_attendance_follow_up_required",
      title: "Aluno marcado para repescagem manual da aula experimental",
      details: {
        booking_id: normalizedBookingId,
        lesson_link: String((resolvedBooking as any)?.lesson_link ?? "").trim() || null,
        reason: "no_show",
      },
      actorType: "attendant",
      actorEmail: auth.user.email,
    });
  }

  return Response.json({
    ok: true,
    booking: responseBooking,
  });
}
