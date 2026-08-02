import {
  appendHistoryEvent,
  requireAtendimentoUser,
  sendAtendimentoWhatsAppText,
} from "@/lib/atendimento/server";
import {
  buildExperimentalClassNoShowRepescagemWhatsAppMessages,
  buildExperimentalClassPostAttendanceWhatsAppMessages,
} from "@/lib/atendimento/experimentalClass";
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

function isExperimentalClassBookingsAttendanceColumnsUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /column .*attendance_status.* does not exist/i.test(message) ||
    /column .*attendance_checked_at.* does not exist/i.test(message) ||
    /could not find the 'attendance_status' column of 'atendimento_experimental_class_bookings' in the schema cache/i.test(
      message,
    ) ||
    /could not find the 'attendance_checked_at' column of 'atendimento_experimental_class_bookings' in the schema cache/i.test(
      message,
    )
  );
}

function isAtendimentoLeadsFunnelStageColumnUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /column .*funnel_stage.* does not exist/i.test(message) ||
    /could not find the 'funnel_stage' column of 'atendimento_leads' in the schema cache/i.test(message)
  );
}

function isAtendimentoLeadsResetableProfileColumnsUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /column .*(cpf|city|state|country|timezone|full_name).* does not exist/i.test(message) ||
    /could not find the '(cpf|city|state|country|timezone|full_name)' column of 'atendimento_leads' in the schema cache/i.test(
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
    .select("id, full_name, phone, funnel_stage, status")
    .eq("id", leadId)
    .maybeSingle();

  if (leadError) {
    return Response.json({ ok: false, error: leadError.message }, { status: 500 });
  }

  const leadName = String((lead as any)?.full_name ?? "").trim();
  const leadPhone = String((lead as any)?.phone ?? "").trim();
  const currentLeadFunnelStage = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase() || null;
  const currentLeadStatus = String((lead as any)?.status ?? "").trim().toLowerCase() || null;

  const checkedAtIso = new Date().toISOString();
  const finalBookingStatus = attendance === "attended" ? "completed" : String((resolvedBooking as any)?.status ?? "scheduled").trim().toLowerCase();

  if (resolvedBooking && String((resolvedBooking as any)?.id ?? "").trim()) {
    const attendanceUpdatePayload: Record<string, unknown> = {
      attendance_status: attendance,
      attendance_checked_at: checkedAtIso,
      updated_at: checkedAtIso,
    };
    if (attendance === "attended") {
      attendanceUpdatePayload.status = "completed";
    }
    if (attendance === "no_show") {
      attendanceUpdatePayload.lesson_link = null;
      attendanceUpdatePayload.student_start_notification_sent_at = null;
      attendanceUpdatePayload.attendant_start_notification_sent_at = null;
    }

    try {
      const { error: updateError } = await admin
        .from("atendimento_experimental_class_bookings")
        .update(attendanceUpdatePayload)
        .eq("id", String((resolvedBooking as any).id));

      if (updateError && isExperimentalClassBookingsAttendanceColumnsUnavailable(updateError)) {
        const fallbackPayload: Record<string, unknown> = { updated_at: checkedAtIso };
        if (attendance === "attended") fallbackPayload.status = "completed";
        try {
          await admin
            .from("atendimento_experimental_class_bookings")
            .update(fallbackPayload)
            .eq("id", String((resolvedBooking as any).id));
        } catch (_e) {}
      } else if (updateError && !isExperimentalClassBookingsTableUnavailable(updateError)) {
        const msg = String((updateError as any)?.message ?? "");
        const code = String((updateError as any)?.code ?? "");
        const isLessonLinkOrNotificationMissingColError =
          attendance === "no_show" &&
          (code === "42703" ||
            code === "PGRST204" ||
            code === "PGRST205" ||
            /lesson_link|notification_sent_at|student_start|attendant_start/i.test(msg));
        if (isLessonLinkOrNotificationMissingColError) {
          try {
            const safeFallbackPayload: Record<string, unknown> = {
              attendance_status: attendance,
              attendance_checked_at: checkedAtIso,
              updated_at: checkedAtIso,
            };
            await admin
              .from("atendimento_experimental_class_bookings")
              .update(safeFallbackPayload)
              .eq("id", String((resolvedBooking as any).id));
          } catch (_e2) {}
        } else {
          return Response.json({ ok: false, error: updateError.message }, { status: 500 });
        }
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !isExperimentalClassBookingsAttendanceColumnsUnavailable(error)
      ) {
        throw error;
      }
      const fallbackPayload: Record<string, unknown> = { updated_at: checkedAtIso };
      if (attendance === "attended") fallbackPayload.status = "completed";
      try {
        await admin
          .from("atendimento_experimental_class_bookings")
          .update(fallbackPayload)
          .eq("id", String((resolvedBooking as any).id));
      } catch (_e) {}
    }
  }

  let nextLeadFunnelStage = currentLeadFunnelStage;
  let nextLeadStatus = currentLeadStatus;

  if (attendance === "attended") {
    nextLeadFunnelStage = "matricula_pendente";
    nextLeadStatus = "matricula_pendente";
  } else if (attendance === "no_show") {
    nextLeadFunnelStage = "repescagem";
    nextLeadStatus = "repescagem";
  }

  if (nextLeadFunnelStage !== currentLeadFunnelStage || nextLeadStatus !== currentLeadStatus) {
    try {
      const leadUpdatePayload: Record<string, unknown> = {
        updated_at: checkedAtIso,
      };
      if (nextLeadFunnelStage) leadUpdatePayload.funnel_stage = nextLeadFunnelStage;
      if (nextLeadStatus) leadUpdatePayload.status = nextLeadStatus;
      if (attendance === "no_show") {
        leadUpdatePayload.cpf = null;
        leadUpdatePayload.city = null;
        leadUpdatePayload.state = null;
        leadUpdatePayload.country = null;
        leadUpdatePayload.timezone = null;
        leadUpdatePayload.full_name = null;
      }
      const { error: leadUpdateError } = await admin
        .from("atendimento_leads")
        .update(leadUpdatePayload)
        .eq("id", leadId);

      if (
        leadUpdateError &&
        (isAtendimentoLeadsFunnelStageColumnUnavailable(leadUpdateError) ||
          isAtendimentoLeadsResetableProfileColumnsUnavailable(leadUpdateError))
      ) {
        try {
          await admin
            .from("atendimento_leads")
            .update({ updated_at: checkedAtIso })
            .eq("id", leadId);
        } catch (_e) {}
      } else if (leadUpdateError) {
        return Response.json({ ok: false, error: leadUpdateError.message }, { status: 500 });
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        (!isAtendimentoLeadsFunnelStageColumnUnavailable(error) &&
          !isAtendimentoLeadsResetableProfileColumnsUnavailable(error))
      ) {
        throw error;
      }
      try {
        await admin
          .from("atendimento_leads")
          .update({ updated_at: checkedAtIso })
          .eq("id", leadId);
      } catch (_e) {}
    }
  }

  const responseBooking = {
    ...(resolvedBooking ?? {}),
    id: String((resolvedBooking as any)?.id ?? normalizedBookingId),
    lead_id: leadId,
    conversation_id: conversationId,
    lesson_link: String((resolvedBooking as any)?.lesson_link ?? "").trim() || null,
    attendance_status: attendance,
    attendance_checked_at: checkedAtIso,
    status: finalBookingStatus,
  };

  if (attendance === "attended") {
    if (!leadPhone) {
      return Response.json({ ok: false, error: "lead_phone_missing" }, { status: 400 });
    }

    const messages = buildExperimentalClassPostAttendanceWhatsAppMessages(leadName);
    const sentMessages: string[] = [];
    let lastError: unknown = null;

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      try {
        await sendAtendimentoWhatsAppText({ phone: leadPhone, message });
        sentMessages.push(message);
      } catch (error) {
        lastError = error;
        break;
      }
    }

    if (lastError) {
      await appendHistoryEvent({
        leadId,
        conversationId,
        eventType: "experimental_class_attendance_confirmation_message_failed",
        title: "Falha ao enviar as mensagens de continuidade apos o comparecimento na aula experimental",
        details: {
          booking_id: normalizedBookingId,
          phone: leadPhone,
          lesson_link: String((resolvedBooking as any)?.lesson_link ?? "").trim() || null,
          total_messages: messages.length,
          sent_messages: sentMessages.length,
          sent_message_contents: sentMessages,
          first_failed_message_index: sentMessages.length,
          first_failed_message_content: messages[sentMessages.length] ?? null,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        },
        actorType: "system",
      });

      return Response.json(
        {
          ok: false,
          error:
            lastError instanceof Error
              ? lastError.message
              : "attendance_confirmation_message_failed",
          booking: responseBooking,
        },
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
        lead_funnel_stage: nextLeadFunnelStage,
        lead_status: nextLeadStatus,
      },
      actorType: "attendant",
      actorEmail: auth.user.email,
    });

    await appendHistoryEvent({
      leadId,
      conversationId,
      eventType: "experimental_class_attendance_confirmation_message_sent",
      title: "Mensagens de continuidade enviadas ao aluno apos o comparecimento na aula experimental",
      details: {
        booking_id: normalizedBookingId,
        phone: leadPhone,
        total_messages: messages.length,
        message_contents: messages,
        lead_funnel_stage: nextLeadFunnelStage,
        lead_status: nextLeadStatus,
      },
      actorType: "system",
    });
  } else {
    if (!leadPhone) {
      await appendHistoryEvent({
        leadId,
        conversationId,
        eventType: "experimental_class_attendance_no_show_phone_missing",
        title: "Telefone do aluno ausente ao marcar nao comparecimento na aula experimental (mensagens nao enviadas)",
        details: {
          booking_id: normalizedBookingId,
          lead_id: leadId,
          lesson_link: String((resolvedBooking as any)?.lesson_link ?? "").trim() || null,
        },
        actorType: "system",
      });

      return Response.json(
        {
          ok: false,
          error: "lead_phone_missing",
          booking: responseBooking,
        },
        { status: 400 },
      );
    }

    const messages = buildExperimentalClassNoShowRepescagemWhatsAppMessages();
    const sentMessages: string[] = [];
    let lastError: unknown = null;

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      try {
        await sendAtendimentoWhatsAppText({ phone: leadPhone, message });
        sentMessages.push(message);
      } catch (error) {
        lastError = error;
        break;
      }
    }

    if (lastError) {
      await appendHistoryEvent({
        leadId,
        conversationId,
        eventType: "experimental_class_attendance_no_show_message_failed",
        title: "Falha ao enviar as mensagens de repescagem apos aluno nao comparecer a aula experimental",
        details: {
          booking_id: normalizedBookingId,
          phone: leadPhone,
          lesson_link: String((resolvedBooking as any)?.lesson_link ?? "").trim() || null,
          total_messages: messages.length,
          sent_messages: sentMessages.length,
          sent_message_contents: sentMessages,
          first_failed_message_index: sentMessages.length,
          first_failed_message_content: messages[sentMessages.length] ?? null,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        },
        actorType: "system",
      });

      return Response.json(
        {
          ok: false,
          error:
            lastError instanceof Error
              ? lastError.message
              : "attendance_no_show_repescagem_message_failed",
          booking: responseBooking,
        },
        { status: 500 },
      );
    }

    await appendHistoryEvent({
      leadId,
      conversationId,
      eventType: "experimental_class_attendance_no_show_message_sent",
      title: "Mensagens de repescagem enviadas ao aluno apos nao comparecimento na aula experimental",
      details: {
        booking_id: normalizedBookingId,
        phone: leadPhone,
        total_messages: messages.length,
        message_contents: messages,
        lead_funnel_stage: nextLeadFunnelStage,
        lead_status: nextLeadStatus,
        cadastro_reset: {
          cpf: null,
          city: null,
          state: null,
          country: null,
          timezone: null,
          full_name: null,
        },
      },
      actorType: "system",
    });

    await appendHistoryEvent({
      leadId,
      conversationId,
      eventType: "experimental_class_attendance_follow_up_required",
      title: "Aluno marcado para repescagem manual da aula experimental",
      details: {
        booking_id: normalizedBookingId,
        lesson_link: String((resolvedBooking as any)?.lesson_link ?? "").trim() || null,
        reason: "no_show",
        attendance_status: "no_show",
        lead_funnel_stage: nextLeadFunnelStage,
        lead_status: nextLeadStatus,
        cadastro_reset: {
          cpf: null,
          city: null,
          state: null,
          country: null,
          timezone: null,
          full_name: null,
        },
      },
      actorType: "attendant",
      actorEmail: auth.user.email,
    });
  }

  return Response.json({
    ok: true,
    booking: responseBooking,
    lead: {
      id: leadId,
      funnel_stage: nextLeadFunnelStage,
      status: nextLeadStatus,
      updated_at: checkedAtIso,
    },
  });
}
