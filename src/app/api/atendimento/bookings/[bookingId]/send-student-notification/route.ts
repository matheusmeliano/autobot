import {
  appendHistoryEvent,
  requireAtendimentoUser,
  sendAtendimentoWhatsAppText,
  getLeadFirstName,
} from "@/lib/atendimento/server";
import { buildExperimentalClassStudentLessonReadyWhatsAppMessage } from "@/lib/atendimento/experimentalClass";
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

function isExperimentalClassBookingsStudentNotificationColumnUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /column .*student_start_notification_sent_at.* does not exist/i.test(message) ||
    /could not find the 'student_start_notification_sent_at' column of 'atendimento_experimental_class_bookings' in the schema cache/i.test(
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
      }
    | null;

  const admin = createSupabaseAdminClient();
  let resolvedBooking: Record<string, unknown> | null = null;

  const bookingWithLessonLinkResult = await admin
    .from("atendimento_experimental_class_bookings")
    .select(
      "id, lead_id, conversation_id, status, lesson_link, professor_start_at, lead_start_at, student_start_notification_sent_at",
    )
    .eq("id", normalizedBookingId)
    .maybeSingle();

  if (bookingWithLessonLinkResult.error && isExperimentalClassBookingsLessonLinkColumnUnavailable(bookingWithLessonLinkResult.error)) {
    const bookingWithoutLessonLinkResult = await admin
      .from("atendimento_experimental_class_bookings")
      .select(
        "id, lead_id, conversation_id, status, professor_start_at, lead_start_at, student_start_notification_sent_at",
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
  const bookingStatus = String((resolvedBooking as any)?.status ?? "scheduled").trim().toLowerCase();
  const studentNotificationAlreadySent = Boolean(String((resolvedBooking as any)?.student_start_notification_sent_at ?? "").trim());

  if (!leadId) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  if (bookingStatus !== "scheduled" && bookingStatus !== "in_progress") {
    return Response.json({ ok: false, error: "invalid_status" }, { status: 409 });
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
  const leadFirstName = getLeadFirstName(leadName);

  let lessonLink = String((resolvedBooking as any)?.lesson_link ?? "").trim();
  if (!lessonLink) {
    const { data: historyEvents, error: historyError } = await admin
      .from("atendimento_history_events")
      .select("details, created_at")
      .eq("lead_id", leadId)
      .eq("event_type", "experimental_class_link_updated")
      .order("created_at", { ascending: false })
      .limit(1);

    if (historyError) {
      return Response.json({ ok: false, error: historyError.message }, { status: 500 });
    }

    const latestLinkEvent = (historyEvents ?? [])[0] as any;
    if (latestLinkEvent) {
      lessonLink = String(latestLinkEvent?.details?.lesson_link ?? "").trim();
    }
  }

  if (!lessonLink) {
    return Response.json(
      { ok: false, error: "missing_lesson_link" },
      { status: 409 },
    );
  }

  if (!leadPhone) {
    return Response.json({ ok: false, error: "missing_lead_phone" }, { status: 409 });
  }

  const sentAtIso = new Date().toISOString();

  if (resolvedBooking && String((resolvedBooking as any)?.id ?? "").trim()) {
    try {
      const { error: updateError } = await admin
        .from("atendimento_experimental_class_bookings")
        .update({
          student_start_notification_sent_at: sentAtIso,
          updated_at: sentAtIso,
        })
        .eq("id", String((resolvedBooking as any).id));

      if (updateError && isExperimentalClassBookingsStudentNotificationColumnUnavailable(updateError)) {
        try {
          await admin
            .from("atendimento_experimental_class_bookings")
            .update({ updated_at: sentAtIso })
            .eq("id", String((resolvedBooking as any).id));
        } catch (_e) {}
      } else if (updateError && !isExperimentalClassBookingsTableUnavailable(updateError)) {
        return Response.json({ ok: false, error: updateError.message }, { status: 500 });
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !isExperimentalClassBookingsStudentNotificationColumnUnavailable(error)
      ) {
        throw error;
      }
      try {
        await admin
          .from("atendimento_experimental_class_bookings")
          .update({ updated_at: sentAtIso })
          .eq("id", String((resolvedBooking as any).id));
      } catch (_e) {}
    }
  }

  try {
    await sendAtendimentoWhatsAppText({
      phone: leadPhone,
      message: buildExperimentalClassStudentLessonReadyWhatsAppMessage(leadFirstName, lessonLink),
    });
  } catch (error) {
    await appendHistoryEvent({
      leadId,
      conversationId,
      eventType: "experimental_class_student_start_notification_failed",
      title: "Falha ao disparar manualmente o link da aula experimental ao aluno",
      details: {
        booking_id: normalizedBookingId,
        phone: leadPhone,
        lesson_link: lessonLink,
        manually_triggered: true,
        was_already_sent: studentNotificationAlreadySent,
        error: error instanceof Error ? error.message : String(error),
      },
      actorType: "attendant",
      actorEmail: auth.user.email,
    });

    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "student_notification_send_failed",
      },
      { status: 500 },
    );
  }

  await appendHistoryEvent({
    leadId,
    conversationId,
    eventType: "experimental_class_student_start_notification_sent",
    title: studentNotificationAlreadySent
      ? "Link da aula experimental reenviado manualmente ao aluno"
      : "Link da aula experimental disparado manualmente ao aluno",
    details: {
      booking_id: normalizedBookingId,
      phone: leadPhone,
      lesson_link: lessonLink,
      manually_triggered: true,
      was_already_sent: studentNotificationAlreadySent,
    },
    actorType: "attendant",
    actorEmail: auth.user.email,
  });

  const responseBooking = {
    ...(resolvedBooking ?? {}),
    id: String((resolvedBooking as any)?.id ?? normalizedBookingId),
    lead_id: leadId,
    conversation_id: conversationId,
    lesson_link: lessonLink,
    student_start_notification_sent_at: sentAtIso,
    status: bookingStatus,
  };

  return Response.json({
    ok: true,
    booking: responseBooking,
  });
}
