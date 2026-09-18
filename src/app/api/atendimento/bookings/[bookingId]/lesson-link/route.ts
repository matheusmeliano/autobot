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
        lessonLink?: string | null;
        leadId?: string | null;
        conversationId?: string | null;
        professorDate?: string | null;
        professorTime?: string | null;
        professorStartAt?: string | null;
        leadDate?: string | null;
        leadTime?: string | null;
        leadTimeZone?: string | null;
        professorTimeZone?: string | null;
        status?: string | null;
      }
    | null;

  const lessonLink = String(payload?.lessonLink ?? "").trim() || null;
  const admin = createSupabaseAdminClient();

  let resolvedBooking: Record<string, unknown> | null = null;
  let tableUnavailable = false;
  let lessonLinkColumnUnavailable = false;

  const bookingWithLessonLinkResult = await admin
    .from("atendimento_experimental_class_bookings")
    .select(
      "id, lead_id, conversation_id, status, lesson_link, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, lead_timezone, professor_timezone, created_at",
    )
    .eq("id", normalizedBookingId)
    .maybeSingle();

  if (bookingWithLessonLinkResult.error && isExperimentalClassBookingsLessonLinkColumnUnavailable(bookingWithLessonLinkResult.error)) {
    lessonLinkColumnUnavailable = true;

    const bookingWithoutLessonLinkResult = await admin
      .from("atendimento_experimental_class_bookings")
      .select(
        "id, lead_id, conversation_id, status, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, lead_timezone, professor_timezone, created_at",
      )
      .eq("id", normalizedBookingId)
      .maybeSingle();

    tableUnavailable = isExperimentalClassBookingsTableUnavailable(bookingWithoutLessonLinkResult.error);
    if (bookingWithoutLessonLinkResult.error && !tableUnavailable) {
      return Response.json({ ok: false, error: bookingWithoutLessonLinkResult.error.message }, { status: 500 });
    }

    resolvedBooking = (bookingWithoutLessonLinkResult.data as Record<string, unknown> | null) ?? null;
  } else {
    tableUnavailable = isExperimentalClassBookingsTableUnavailable(bookingWithLessonLinkResult.error);
    if (bookingWithLessonLinkResult.error && !tableUnavailable) {
      return Response.json({ ok: false, error: bookingWithLessonLinkResult.error.message }, { status: 500 });
    }

    resolvedBooking = (bookingWithLessonLinkResult.data as Record<string, unknown> | null) ?? null;
  }

  if (!resolvedBooking && !tableUnavailable && payload?.leadId) {
    const selectWithLessonLink =
      "id, lead_id, conversation_id, status, lesson_link, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, lead_timezone, professor_timezone, created_at, updated_at";
    const selectWithoutLessonLink =
      "id, lead_id, conversation_id, status, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, lead_timezone, professor_timezone, created_at, updated_at";

    let leadBookings: Record<string, unknown>[] | null = null;
    let leadBookingsError: unknown = null;

    const leadBookingsWithLessonLinkResult = await admin
      .from("atendimento_experimental_class_bookings")
      .select(selectWithLessonLink)
      .eq("lead_id", String(payload.leadId))
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10);

    if (leadBookingsWithLessonLinkResult.error && isExperimentalClassBookingsLessonLinkColumnUnavailable(leadBookingsWithLessonLinkResult.error)) {
      lessonLinkColumnUnavailable = true;
      const leadBookingsWithoutLessonLinkResult = await admin
        .from("atendimento_experimental_class_bookings")
        .select(selectWithoutLessonLink)
        .eq("lead_id", String(payload.leadId))
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(10);

      leadBookings = (leadBookingsWithoutLessonLinkResult.data as Record<string, unknown>[] | null) ?? null;
      leadBookingsError = leadBookingsWithoutLessonLinkResult.error;
    } else {
      leadBookings = (leadBookingsWithLessonLinkResult.data as Record<string, unknown>[] | null) ?? null;
      leadBookingsError = leadBookingsWithLessonLinkResult.error;
    }

    if (leadBookingsError && !isExperimentalClassBookingsTableUnavailable(leadBookingsError)) {
      return Response.json({ ok: false, error: String((leadBookingsError as any)?.message ?? "booking_lookup_failed") }, { status: 500 });
    }

    resolvedBooking =
      (leadBookings ?? []).find((row) => {
        const sameProfessorStartAt =
          String(row?.professor_start_at ?? "").trim() &&
          String(row?.professor_start_at ?? "").trim() === String(payload.professorStartAt ?? "").trim();
        const sameConversation =
          String(row?.conversation_id ?? "").trim() &&
          String(row?.conversation_id ?? "").trim() === String(payload.conversationId ?? "").trim();
        return sameProfessorStartAt || sameConversation;
      }) ?? null;
  }

  const leadId = String((resolvedBooking as any)?.lead_id ?? payload?.leadId ?? "").trim();
  const conversationId = String((resolvedBooking as any)?.conversation_id ?? payload?.conversationId ?? "").trim();

  if (!leadId) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  let responseBooking: Record<string, unknown> = {
    id: String((resolvedBooking as any)?.id ?? normalizedBookingId),
    lead_id: leadId,
    conversation_id: conversationId,
    status: String((resolvedBooking as any)?.status ?? payload?.status ?? "scheduled").trim() || "scheduled",
    lesson_link: lessonLink,
    professor_timezone: String((resolvedBooking as any)?.professor_timezone ?? payload?.professorTimeZone ?? "").trim(),
    lead_timezone: String((resolvedBooking as any)?.lead_timezone ?? payload?.leadTimeZone ?? "").trim(),
    professor_date: String((resolvedBooking as any)?.professor_date ?? payload?.professorDate ?? "").trim(),
    professor_time: String((resolvedBooking as any)?.professor_time ?? payload?.professorTime ?? "").trim(),
    professor_start_at: String((resolvedBooking as any)?.professor_start_at ?? payload?.professorStartAt ?? "").trim(),
    lead_date: String((resolvedBooking as any)?.lead_date ?? payload?.leadDate ?? "").trim(),
    lead_time: String((resolvedBooking as any)?.lead_time ?? payload?.leadTime ?? "").trim(),
    lead_start_at: String((resolvedBooking as any)?.lead_start_at ?? payload?.professorStartAt ?? "").trim(),
    created_at: String((resolvedBooking as any)?.created_at ?? new Date().toISOString()),
    source: String((resolvedBooking as any)?.id ?? "").trim() ? "table" : "history",
  };

  if (resolvedBooking && !tableUnavailable && !lessonLinkColumnUnavailable) {
    const { data: updatedBooking, error: updateError } = await admin
      .from("atendimento_experimental_class_bookings")
      .update({
        lesson_link: lessonLink,
        updated_at: new Date().toISOString(),
      })
      .eq("id", String((resolvedBooking as any)?.id ?? ""))
      .select(
        "id, lead_id, conversation_id, status, lesson_link, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, created_at",
      )
      .maybeSingle();

    if (updateError && !isExperimentalClassBookingsLessonLinkColumnUnavailable(updateError)) {
      return Response.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    if (updateError && isExperimentalClassBookingsLessonLinkColumnUnavailable(updateError)) {
      lessonLinkColumnUnavailable = true;
    } else if (updatedBooking) {
      responseBooking = {
        ...(updatedBooking as Record<string, unknown>),
        source: "table",
      };
    }
  } else if (!resolvedBooking && !tableUnavailable) {
    const nowIso = new Date().toISOString();
    const insertPayloadBase: Record<string, unknown> = {
      id: normalizedBookingId,
      lead_id: leadId,
      conversation_id: conversationId || null,
      status: String(responseBooking.status ?? "scheduled").trim() || "scheduled",
      professor_timezone: String(responseBooking.professor_timezone ?? "").trim(),
      lead_timezone: String(responseBooking.lead_timezone ?? "").trim(),
      professor_date: String(responseBooking.professor_date ?? "").trim(),
      professor_time: String(responseBooking.professor_time ?? "").trim(),
      professor_start_at: String(responseBooking.professor_start_at ?? "").trim(),
      lead_date: String(responseBooking.lead_date ?? "").trim(),
      lead_time: String(responseBooking.lead_time ?? "").trim(),
      lead_start_at: String(responseBooking.lead_start_at ?? "").trim(),
      updated_at: nowIso,
      created_at: String(responseBooking.created_at ?? nowIso),
    };
    let inserted: Record<string, unknown> | null = null;

    if (!lessonLinkColumnUnavailable) {
      try {
        const { data: insertWithLink, error: insertWithLinkError } = await admin
          .from("atendimento_experimental_class_bookings")
          .insert({ ...insertPayloadBase, lesson_link: lessonLink })
          .select(
            "id, lead_id, conversation_id, status, lesson_link, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, created_at",
          )
          .maybeSingle();
        if (!insertWithLinkError && insertWithLink) {
          inserted = insertWithLink as Record<string, unknown>;
        } else if (insertWithLinkError && isExperimentalClassBookingsLessonLinkColumnUnavailable(insertWithLinkError)) {
          lessonLinkColumnUnavailable = true;
        } else if (insertWithLinkError) {
          throw insertWithLinkError;
        }
      } catch (insertError) {
        if (
          insertError instanceof Error &&
          !isExperimentalClassBookingsLessonLinkColumnUnavailable(insertError)
        ) {
          throw insertError;
        }
        lessonLinkColumnUnavailable = true;
      }
    }

    if (!inserted && !lessonLinkColumnUnavailable) {
      try {
        const { data: insertNoLink, error: insertNoLinkError } = await admin
          .from("atendimento_experimental_class_bookings")
          .insert(insertPayloadBase)
          .select(
            "id, lead_id, conversation_id, status, lesson_link, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, created_at",
          )
          .maybeSingle();
        if (!insertNoLinkError && insertNoLink) {
          inserted = insertNoLink as Record<string, unknown>;
        }
      } catch (_e) {
        inserted = null;
      }
    }

    if (inserted) {
      responseBooking = {
        ...inserted,
        lesson_link: lessonLink,
        source: "table",
      };
    }
  }

  await appendHistoryEvent({
    leadId,
    conversationId: conversationId || null,
    eventType: "experimental_class_link_updated",
    title: lessonLink ? "Link da aula atualizado manualmente" : "Link da aula removido manualmente",
    details: {
      booking_id: String(responseBooking.id ?? normalizedBookingId),
      status: String(responseBooking.status ?? "scheduled"),
      lesson_link: lessonLink,
      professor_timezone: String(responseBooking.professor_timezone ?? ""),
      lead_timezone: String(responseBooking.lead_timezone ?? ""),
      professor_date: String(responseBooking.professor_date ?? ""),
      professor_time: String(responseBooking.professor_time ?? ""),
      professor_start_at: String(responseBooking.professor_start_at ?? ""),
      lead_date: String(responseBooking.lead_date ?? ""),
      lead_time: String(responseBooking.lead_time ?? ""),
      lead_start_at: String(responseBooking.lead_start_at ?? ""),
    },
    actorType: "attendant",
    actorEmail: auth.user.email,
  });

  return Response.json({
    ok: true,
    booking: responseBooking,
  });
}
