import {
  appendHistoryEvent,
  requireAtendimentoUser,
  sendAtendimentoWhatsAppText,
} from "@/lib/atendimento/server";
import {
  buildExperimentalClassAttendantStartReminderWhatsAppMessage,
  buildExperimentalClassRegisteredAttendantStartReminderWhatsAppMessage,
  buildExperimentalClassStudentLessonReadyWhatsAppMessage,
  EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
  EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
  resolveExperimentalClassAssignedProfessorPhone,
} from "@/lib/atendimento/experimentalClass";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function getLeadFirstName(name: string | null | undefined) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[0] ?? "Aluno";
}

function getLeadFullName(name: string | null | undefined) {
  const clean = String(name ?? "").trim();
  return clean || "Aluno sem identificacao";
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

function isExperimentalClassBookingsNotificationColumnsUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /column .*(student_start_notification_sent_at|attendant_start_notification_sent_at).* does not exist/i.test(
      message,
    ) ||
    /could not find the '(student_start_notification_sent_at|attendant_start_notification_sent_at)' column of 'atendimento_experimental_class_bookings' in the schema cache/i.test(
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
      "id, lead_id, conversation_id, status, lesson_link, professor_start_at, lead_start_at, student_start_notification_sent_at, attendant_start_notification_sent_at, assigned_professor_name, assigned_professor_phone",
    )
    .eq("id", normalizedBookingId)
    .maybeSingle();

  if (bookingWithLessonLinkResult.error && isExperimentalClassBookingsLessonLinkColumnUnavailable(bookingWithLessonLinkResult.error)) {
    const bookingWithoutLessonLinkResult = await admin
      .from("atendimento_experimental_class_bookings")
      .select(
        "id, lead_id, conversation_id, status, professor_start_at, lead_start_at, student_start_notification_sent_at, attendant_start_notification_sent_at, assigned_professor_name, assigned_professor_phone",
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

  if (!resolvedBooking) {
    const trimmedPayloadLeadId =
      payload?.leadId !== undefined && payload?.leadId !== null && String(payload.leadId).trim() !== ""
        ? String(payload.leadId).trim()
        : "";
    let fallbackLeadId = trimmedPayloadLeadId;
    if (!fallbackLeadId) {
      if (normalizedBookingId === "fallback") {
        fallbackLeadId = "";
      } else if (normalizedBookingId.startsWith("draft-")) {
        fallbackLeadId = normalizedBookingId.slice("draft-".length);
      } else {
        fallbackLeadId = "";
      }
    }
    if (fallbackLeadId) {
      const { data: fallbackLead, error: flErr } = await admin
        .from("atendimento_leads")
        .select(
          "id, full_name, phone, funnel_stage, experimental_class_status, experimental_class_booking_id, experimental_class_link, experimental_class_lead_date, experimental_class_lead_time, experimental_class_professor_date, experimental_class_professor_time, experimental_class_lead_start_at, experimental_class_professor_start_at, experimental_class_student_notification_sent_at, experimental_class_professor_name, experimental_class_professor_phone, experimental_class_attendant_notification_sent_at, experimental_class_registered_attendant_notification_sent_at",
        )
        .eq("id", fallbackLeadId)
        .maybeSingle();
      if (!flErr && fallbackLead) {
        resolvedBooking = {
          id: normalizedBookingId || `draft-${fallbackLeadId}`,
          lead_id: String((fallbackLead as any).id),
          conversation_id: null,
          status:
            String((fallbackLead as any).experimental_class_status ?? "").trim() ||
            String((fallbackLead as any).funnel_stage ?? "").trim() ||
            "scheduled",
          lesson_link: String((fallbackLead as any).experimental_class_link ?? "").trim(),
          professor_start_at: String((fallbackLead as any).experimental_class_professor_start_at ?? "").trim(),
          lead_start_at:
            String((fallbackLead as any).experimental_class_lead_start_at ?? "").trim() ||
            String((fallbackLead as any).experimental_class_professor_start_at ?? "").trim(),
          student_start_notification_sent_at:
            String((fallbackLead as any).experimental_class_student_notification_sent_at ?? "").trim(),
          attendant_start_notification_sent_at:
            String((fallbackLead as any).experimental_class_attendant_notification_sent_at ?? "").trim(),
          assigned_professor_name: String((fallbackLead as any).experimental_class_professor_name ?? "").trim(),
          assigned_professor_phone: String((fallbackLead as any).experimental_class_professor_phone ?? "").trim(),
          source: "draft_fallback",
        } as unknown as Record<string, unknown>;
      }
    }
  }

  const leadId = String((resolvedBooking as any)?.lead_id ?? payload?.leadId ?? "").trim();
  const conversationId = String((resolvedBooking as any)?.conversation_id ?? payload?.conversationId ?? "").trim() || null;
  const bookingStatus = String((resolvedBooking as any)?.status ?? "scheduled").trim().toLowerCase();
  const studentNotificationAlreadySent = Boolean(String((resolvedBooking as any)?.student_start_notification_sent_at ?? "").trim());
  const attendantNotificationAlreadySent = Boolean(String((resolvedBooking as any)?.attendant_start_notification_sent_at ?? "").trim());
  const professorStartAtRaw = String((resolvedBooking as any)?.professor_start_at ?? "").trim();

  if (!leadId) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  if (bookingStatus !== "scheduled" && bookingStatus !== "in_progress") {
    return Response.json({ ok: false, error: "invalid_status" }, { status: 409 });
  }

  const { data: lead, error: leadError } = await admin
    .from("atendimento_leads")
    .select("id, full_name, phone, experimental_class_link, experimental_class_professor_name, experimental_class_professor_phone")
    .eq("id", leadId)
    .maybeSingle();

  if (leadError) {
    return Response.json({ ok: false, error: leadError.message }, { status: 500 });
  }

  const leadName = String((lead as any)?.full_name ?? "").trim();
  const leadPhone = String((lead as any)?.phone ?? "").trim();
  const leadFirstName = getLeadFirstName(leadName);
  const leadFullName = getLeadFullName(leadName);

  let lessonLink = String((resolvedBooking as any)?.lesson_link ?? "").trim();
  if (!lessonLink) {
    lessonLink = String((lead as any)?.experimental_class_link ?? "").trim();
  }
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

  const resolvedAssignedProfessor = resolveExperimentalClassAssignedProfessorPhone({
    bookingAssignedPhone: String((resolvedBooking as any)?.assigned_professor_phone ?? "").trim(),
    bookingAssignedName: String((resolvedBooking as any)?.assigned_professor_name ?? "").trim(),
    flatAssignedPhone: String((lead as any)?.experimental_class_professor_phone ?? "").trim(),
    flatAssignedName: String((lead as any)?.experimental_class_professor_name ?? "").trim(),
  });
  if (!resolvedAssignedProfessor || !String(resolvedAssignedProfessor.phone ?? "").trim()) {
    return Response.json(
      { ok: false, error: "missing_experimental_professor" },
      { status: 409 },
    );
  }

  if (!leadPhone) {
    return Response.json({ ok: false, error: "missing_lead_phone" }, { status: 409 });
  }

  const sentAtIso = new Date().toISOString();
  const normalizedBookingPk = resolvedBooking && String((resolvedBooking as any)?.id ?? "").trim();

  let studentNotificationOk = studentNotificationAlreadySent;
  let attendantNotificationOk = attendantNotificationAlreadySent;
  let registeredAttendantNotificationOk = false;

  let studentSendFailedError: string | null = null;
  let attendantSendFailedError: string | null = null;
  let registeredAttendantSendFailedError: string | null = null;

  const assignedProfessorNotificationPhone =
    resolveExperimentalClassAssignedProfessorPhone({
      bookingAssignedPhone: String((resolvedBooking as any)?.assigned_professor_phone ?? "").trim(),
      bookingAssignedName: String((resolvedBooking as any)?.assigned_professor_name ?? "").trim(),
      flatAssignedPhone: String((lead as any)?.experimental_class_professor_phone ?? "").trim(),
      flatAssignedName: String((lead as any)?.experimental_class_professor_name ?? "").trim(),
    })?.phone ?? EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE;

  if (!studentNotificationAlreadySent) {
    try {
      await sendAtendimentoWhatsAppText({
        phone: leadPhone,
        message: buildExperimentalClassStudentLessonReadyWhatsAppMessage(leadFirstName, lessonLink),
        allowNoInbound: true,
      });
      studentNotificationOk = true;
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
    } catch (error) {
      studentSendFailedError = error instanceof Error ? error.message : String(error);
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
          error: studentSendFailedError,
        },
        actorType: "attendant",
        actorEmail: auth.user.email,
      });
    }
  }

  if (!attendantNotificationAlreadySent) {
    try {
      await sendAtendimentoWhatsAppText({
        phone: assignedProfessorNotificationPhone,
        message: buildExperimentalClassAttendantStartReminderWhatsAppMessage(leadFullName, lessonLink),
      });
      attendantNotificationOk = true;
      await appendHistoryEvent({
        leadId,
        conversationId,
        eventType: "experimental_class_attendant_start_notification_sent",
        title: attendantNotificationAlreadySent
          ? "Lembrete de inicio da aula experimental reenviado manualmente ao atendente"
          : "Lembrete de inicio da aula experimental disparado manualmente ao atendente",
        details: {
          booking_id: normalizedBookingId,
          phone: assignedProfessorNotificationPhone,
          lesson_link: lessonLink,
          start_at: professorStartAtRaw || null,
          manually_triggered: true,
          was_already_sent: attendantNotificationAlreadySent,
        },
        actorType: "attendant",
        actorEmail: auth.user.email,
      });
    } catch (error) {
      attendantSendFailedError = error instanceof Error ? error.message : String(error);
      await appendHistoryEvent({
        leadId,
        conversationId,
        eventType: "experimental_class_attendant_start_notification_failed",
        title: "Falha ao disparar manualmente o lembrete do inicio da aula experimental ao atendente",
        details: {
          booking_id: normalizedBookingId,
          phone: assignedProfessorNotificationPhone,
          lesson_link: lessonLink,
          start_at: professorStartAtRaw || null,
          manually_triggered: true,
          was_already_sent: attendantNotificationAlreadySent,
          error: attendantSendFailedError,
        },
        actorType: "attendant",
        actorEmail: auth.user.email,
      });
    }
  }

  try {
    await sendAtendimentoWhatsAppText({
      phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
      message: buildExperimentalClassRegisteredAttendantStartReminderWhatsAppMessage(leadFullName, lessonLink),
    });
    registeredAttendantNotificationOk = true;
    await appendHistoryEvent({
      leadId,
      conversationId,
      eventType: "experimental_class_registered_attendant_start_notification_sent",
      title: "Lembrete de inicio da aula experimental disparado manualmente ao atendente cadastrado",
      details: {
        booking_id: normalizedBookingId,
        phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
        lesson_link: lessonLink,
        start_at: professorStartAtRaw || null,
        manually_triggered: true,
      },
      actorType: "attendant",
      actorEmail: auth.user.email,
    });
  } catch (error) {
    registeredAttendantSendFailedError = error instanceof Error ? error.message : String(error);
    await appendHistoryEvent({
      leadId,
      conversationId,
      eventType: "experimental_class_registered_attendant_start_notification_failed",
      title: "Falha ao disparar manualmente o lembrete do inicio da aula experimental ao atendente cadastrado",
      details: {
        booking_id: normalizedBookingId,
        phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
        lesson_link: lessonLink,
        start_at: professorStartAtRaw || null,
        manually_triggered: true,
        error: registeredAttendantSendFailedError,
      },
      actorType: "attendant",
      actorEmail: auth.user.email,
    });
  }

  if (normalizedBookingPk) {
    const isDraftFallback =
      String((resolvedBooking as any)?.source ?? "").trim() === "draft_fallback";
    if (!isDraftFallback) {
      try {
        const patch: Record<string, string> = { updated_at: sentAtIso };
        if (studentNotificationOk) patch.student_start_notification_sent_at = sentAtIso;
        if (attendantNotificationOk) patch.attendant_start_notification_sent_at = sentAtIso;
        const { error: updateError } = await admin
          .from("atendimento_experimental_class_bookings")
          .update(patch as any)
          .eq("id", normalizedBookingPk);

        if (updateError && isExperimentalClassBookingsNotificationColumnsUnavailable(updateError)) {
          try {
            await admin
              .from("atendimento_experimental_class_bookings")
              .update({ updated_at: sentAtIso })
              .eq("id", normalizedBookingPk);
          } catch (_e) {}
        } else if (updateError && !isExperimentalClassBookingsTableUnavailable(updateError)) {
          return Response.json({ ok: false, error: updateError.message }, { status: 500 });
        }
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !isExperimentalClassBookingsNotificationColumnsUnavailable(error)
        ) {
          throw error;
        }
        try {
          await admin
            .from("atendimento_experimental_class_bookings")
            .update({ updated_at: sentAtIso })
            .eq("id", normalizedBookingPk);
        } catch (_e) {}
      }
    } else {
      try {
        const patchLead: Record<string, any> = { updated_at: sentAtIso };
        if (studentNotificationOk) {
          patchLead.experimental_class_student_start_notification_sent_at = sentAtIso;
        }
        if (attendantNotificationOk) {
          patchLead.experimental_class_attendant_start_notification_sent_at = sentAtIso;
        }
        const { error: patchLeadErr } = await admin
          .from("atendimento_leads")
          .update(patchLead)
          .eq("id", leadId);
        if (patchLeadErr) {
          console.error(
            `[send-student-notification] draft fallback: falhou ao marcar sent_at no lead ${leadId}`,
            patchLeadErr,
          );
        }
      } catch (e) {
        console.error(
          `[send-student-notification] draft fallback: erro ao marcar sent_at no lead ${leadId}`,
          e,
        );
      }
    }
  }

  const finalStudentSentAt = studentNotificationOk ? sentAtIso : (String((resolvedBooking as any)?.student_start_notification_sent_at ?? "").trim() || null);
  const finalAttendantSentAt = attendantNotificationOk ? sentAtIso : (String((resolvedBooking as any)?.attendant_start_notification_sent_at ?? "").trim() || null);

  const responseBooking = {
    ...(resolvedBooking ?? {}),
    id: String((resolvedBooking as any)?.id ?? normalizedBookingId),
    lead_id: leadId,
    conversation_id: conversationId,
    lesson_link: lessonLink,
    student_start_notification_sent_at: finalStudentSentAt,
    attendant_start_notification_sent_at: finalAttendantSentAt,
    status: bookingStatus,
  };

  const allMandatoryOk = studentNotificationOk && attendantNotificationOk;

  return Response.json({
    ok: allMandatoryOk,
    all_mandatory_sent: allMandatoryOk,
    student_notification_sent: studentNotificationOk,
    student_notification_error: studentSendFailedError,
    attendant_notification_sent: attendantNotificationOk,
    attendant_notification_error: attendantSendFailedError,
    registered_attendant_notification_sent: registeredAttendantNotificationOk,
    registered_attendant_notification_error: registeredAttendantSendFailedError,
    booking: responseBooking,
    error: allMandatoryOk
      ? null
      : [
          studentSendFailedError ? `aluno: ${studentSendFailedError}` : null,
          attendantSendFailedError ? `atendente: ${attendantSendFailedError}` : null,
        ].filter(Boolean).join(" | ") || "Algum destinatário obrigatório não recebeu.",
  }, {
    status: allMandatoryOk ? 200 : 502,
  });
}
