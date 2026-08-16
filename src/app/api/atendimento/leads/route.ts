import { ATENDIMENTO_PROFESSOR_TIME_ZONE, isZapiInternalBlocklistedPhone } from "@/lib/atendimento/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { calculatePastRecurringOccurrences } from "@/lib/atendimento/experimentalClass";
import {
  loadHiddenWhatsAppPhoneBlocklist,
  phoneIsInHiddenBrazilianBlocklist,
} from "@/lib/painelHiddenPhones";

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

function getLeadSortTime(row: any) {
  const candidates = [
    row?.last_interaction_at,
    row?.conversation?.last_message_at,
    row?.conversation?.updated_at,
    row?.updated_at,
    row?.created_at,
  ];

  for (const candidate of candidates) {
    const time = new Date(String(candidate ?? "")).getTime();
    if (Number.isFinite(time) && time > 0) return time;
  }

  return 0;
}

export async function GET(req: Request) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = String(searchParams.get("q") ?? "").trim().toLowerCase();
  const status = String(searchParams.get("status") ?? "").trim().toLowerCase();
  const stage = String(searchParams.get("stage") ?? "").trim().toLowerCase();
  const admin = createSupabaseAdminClient();

  const { data: leads, error } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const hiddenBlocklist = await loadHiddenWhatsAppPhoneBlocklist({ supabaseAdmin: admin });

  const leadRows = (leads ?? [])
    .filter((row: any) => !phoneIsInHiddenBrazilianBlocklist(String(row?.phone ?? ""), hiddenBlocklist)) as any[];
  const leadIds = leadRows.map((row) => String(row.id ?? "")).filter(Boolean);
  const conversationsByLeadId = new Map<string, any>();
  const bookingsByLeadId = new Map<string, any>();
  const latestBookingByLeadId = new Map<string, any>();
  const futureExperimentalBookingByLeadId = new Map<string, any>();
  const cancelledLeadBookingIds = new Set<string>();
  const cancelledByHistoryLeadIds = new Set<string>();
  const cancelledAtByLeadId = new Map<string, string>();
  const latestClassEventByLeadId = new Map<string, string>();

  if (leadIds.length > 0) {
    const { data: conversations, error: conversationsError } = await admin
      .from("atendimento_conversations")
      .select("id, lead_id, public_link_id, channel, public_slug, bot_enabled, last_message_preview, last_message_at, created_at, updated_at")
      .in("lead_id", leadIds)
      .order("updated_at", { ascending: false });

    if (conversationsError) {
      return Response.json({ ok: false, error: conversationsError.message }, { status: 500 });
    }

    for (const conversation of conversations ?? []) {
      const leadId = String((conversation as any)?.lead_id ?? "");
      if (!leadId || conversationsByLeadId.has(leadId)) continue;
      conversationsByLeadId.set(leadId, conversation);
    }

    let bookings: any[] | null = null;
    let bookingsError: any = null;

    const bookingsSelectWithLessonLink =
      "id, lead_id, status, lesson_link, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, created_at, updated_at";
    const bookingsSelectWithoutLessonLink =
      "id, lead_id, status, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, created_at, updated_at";

    const bookingsWithLessonLinkResult = await admin
      .from("atendimento_experimental_class_bookings")
      .select(bookingsSelectWithLessonLink)
      .in("lead_id", leadIds)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (bookingsWithLessonLinkResult.error && isExperimentalClassBookingsLessonLinkColumnUnavailable(bookingsWithLessonLinkResult.error)) {
      const bookingsWithoutLessonLinkResult = await admin
        .from("atendimento_experimental_class_bookings")
        .select(bookingsSelectWithoutLessonLink)
        .in("lead_id", leadIds)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false });

      bookings = bookingsWithoutLessonLinkResult.data as any[] | null;
      bookingsError = bookingsWithoutLessonLinkResult.error;
    } else {
      bookings = bookingsWithLessonLinkResult.data as any[] | null;
      bookingsError = bookingsWithLessonLinkResult.error;
    }

    if (bookingsError && !isExperimentalClassBookingsTableUnavailable(bookingsError)) {
      return Response.json({ ok: false, error: bookingsError.message }, { status: 500 });
    }

    for (const booking of bookings ?? []) {
      const leadId = String((booking as any)?.lead_id ?? "");
      const status = String((booking as any)?.status ?? "").trim().toLowerCase();
      if (!leadId) continue;
      if (status === "cancelled") {
        cancelledLeadBookingIds.add(leadId);
        continue;
      }
      if (status !== "scheduled") continue;
      if (bookingsByLeadId.has(leadId)) continue;
      bookingsByLeadId.set(leadId, {
        ...(booking as any),
        lesson_link: String((booking as any)?.lesson_link ?? "").trim() || null,
        student_start_notification_sent_at: null,
        attendant_start_notification_sent_at: null,
        attendance_status: null,
        attendance_checked_at: null,
        professor_timezone: String((booking as any)?.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
        source: "table",
      });
    }

    const parseStartAtMs = (value: unknown): number => {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const t = new Date(raw).getTime();
      return Number.isFinite(t) && t > 0 ? t : 0;
    };
    const nowMs = Date.now();
    for (const booking of bookings ?? []) {
      const leadId = String((booking as any)?.lead_id ?? "");
      const status = String((booking as any)?.status ?? "").trim().toLowerCase();
      if (!leadId) continue;
      if (status === "cancelled") continue;
      const candidate = {
        ...(booking as any),
        lesson_link: String((booking as any)?.lesson_link ?? "").trim() || null,
        student_start_notification_sent_at: null,
        attendant_start_notification_sent_at: null,
        attendance_status: null,
        attendance_checked_at: null,
        professor_timezone: String((booking as any)?.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
        source: "table",
      };
      const candidateMs = parseStartAtMs(candidate.professor_start_at || candidate.lead_start_at);
      const current = latestBookingByLeadId.get(leadId);
      const currentMs = current
        ? parseStartAtMs(current.professor_start_at || current.lead_start_at)
        : 0;
      if (candidateMs > 0 && candidateMs < nowMs && candidateMs > currentMs) {
        latestBookingByLeadId.set(leadId, candidate);
      }
      if (candidateMs >= nowMs) {
        const curFuture = futureExperimentalBookingByLeadId.get(leadId);
        const curFutureMs = curFuture
          ? parseStartAtMs(curFuture.professor_start_at || curFuture.lead_start_at)
          : 0;
        if (curFutureMs <= 0 || (candidateMs > 0 && candidateMs < curFutureMs)) {
          futureExperimentalBookingByLeadId.set(leadId, candidate);
        }
      }
    }
  }

  const draftDateByLeadId = new Map<string, { professor_date: string; lead_date: string; label?: string | null; at: string } | null>();
  const draftTimeByLeadId = new Map<string, { professor_date: string; professor_time: string; lead_date: string; lead_time: string; professor_start_at: string; lead_start_at: string; at: string } | null>();

  if (leadIds.length > 0) {
    const { data: historyEvents, error: historyError } = await admin
      .from("atendimento_history_events")
      .select("id, lead_id, event_type, conversation_id, created_at, details")
      .in("lead_id", leadIds)
      .in("event_type", [
        "experimental_class_date_selected",
        "experimental_class_time_selected",
        "experimental_class_scheduled",
        "experimental_class_cancelled",
        "experimental_class_link_updated",
        "experimental_class_student_start_notification_sent",
        "experimental_class_attendant_start_notification_sent",
        "experimental_class_attendance_confirmed",
        "experimental_class_attendance_follow_up_required",
      ])
      .order("created_at", { ascending: false });

    if (historyError) {
      return Response.json({ ok: false, error: historyError.message }, { status: 500 });
    }

    const lessonLinkByLeadId = new Map<string, string | null>();
    for (const event of historyEvents ?? []) {
      const leadId = String((event as any)?.lead_id ?? "");
      if (!leadId) continue;
      const eventType = String((event as any)?.event_type ?? "").trim().toLowerCase();
      if (eventType === "experimental_class_cancelled") {
        cancelledByHistoryLeadIds.add(leadId);
        if (!cancelledAtByLeadId.has(leadId)) {
          cancelledAtByLeadId.set(leadId, String((event as any)?.created_at ?? "").trim());
        }
      }
      if (eventType.startsWith("experimental_class_") && !latestClassEventByLeadId.has(leadId)) {
        latestClassEventByLeadId.set(leadId, eventType);
      }
    }
    for (const event of historyEvents ?? []) {
      const leadId = String((event as any)?.lead_id ?? "");
      if (!leadId) continue;
      const details = ((event as any)?.details ?? {}) as Record<string, unknown>;
      const eventType = String((event as any)?.event_type ?? "").trim().toLowerCase();
      const eventCreatedAt = String((event as any)?.created_at ?? "").trim() || null;
      const lessonLink = String(details.lesson_link ?? "").trim() || null;

      if (eventType === "experimental_class_link_updated") {
        if (!lessonLinkByLeadId.has(leadId)) {
          lessonLinkByLeadId.set(leadId, lessonLink);
        }
        continue;
      }

      if (
        !bookingsByLeadId.has(leadId) &&
        eventType === "experimental_class_scheduled" &&
        !cancelledLeadBookingIds.has(leadId) &&
        !cancelledByHistoryLeadIds.has(leadId)
      ) {
        const bookingStatus = String(details.status ?? "").trim().toLowerCase() || "scheduled";
        if (bookingStatus === "cancelled") continue;
        bookingsByLeadId.set(leadId, {
          id: String((event as any)?.id ?? ""),
          status: bookingStatus,
          lesson_link: lessonLink,
          student_start_notification_sent_at: null,
          attendant_start_notification_sent_at: null,
          attendance_status: null,
          attendance_checked_at: null,
          professor_timezone: String(details.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
          lead_timezone: String(details.lead_timezone ?? ""),
          professor_date: String(details.professor_date ?? ""),
          professor_time: String(details.professor_time ?? ""),
          professor_start_at: String(details.professor_start_at ?? ""),
          lead_date: String(details.lead_date ?? ""),
          lead_time: String(details.lead_time ?? ""),
          lead_start_at: String(details.lead_start_at ?? ""),
          conversation_id: String((event as any)?.conversation_id ?? ""),
          created_at: String((event as any)?.created_at ?? ""),
          source: "history",
        });
      }

      if (eventType === "experimental_class_scheduled" && !cancelledLeadBookingIds.has(leadId) && !cancelledByHistoryLeadIds.has(leadId)) {
        const bookingStatus = String(details.status ?? "").trim().toLowerCase() || "scheduled";
        if (bookingStatus !== "cancelled") {
          const historyCandidate = {
            id: String((event as any)?.id ?? ""),
            status: bookingStatus,
            lesson_link: lessonLink,
            student_start_notification_sent_at: null as null | string,
            attendant_start_notification_sent_at: null as null | string,
            attendance_status: null as null | string,
            attendance_checked_at: null as null | string,
            professor_timezone: String(details.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
            lead_timezone: String(details.lead_timezone ?? ""),
            professor_date: String(details.professor_date ?? ""),
            professor_time: String(details.professor_time ?? ""),
            professor_start_at: String(details.professor_start_at ?? ""),
            lead_date: String(details.lead_date ?? ""),
            lead_time: String(details.lead_time ?? ""),
            lead_start_at: String(details.lead_start_at ?? ""),
            conversation_id: String((event as any)?.conversation_id ?? ""),
            created_at: String((event as any)?.created_at ?? ""),
            source: "history" as const,
          };
          const cMs = parseStartAtMs
            ? parseStartAtMs(historyCandidate.professor_start_at || historyCandidate.lead_start_at)
            : (() => {
                const v = String((historyCandidate.professor_start_at || historyCandidate.lead_start_at) ?? "").trim();
                if (!v) return 0;
                const t = new Date(v).getTime();
                return Number.isFinite(t) && t > 0 ? t : 0;
              })();
          const currentLatest = latestBookingByLeadId.get(leadId);
          const curMs = currentLatest
            ? (() => {
                const v = String((currentLatest.professor_start_at || currentLatest.lead_start_at) ?? "").trim();
                if (!v) return 0;
                const t = new Date(v).getTime();
                return Number.isFinite(t) && t > 0 ? t : 0;
              })()
            : 0;
          if (cMs > 0 && cMs < nowMs && cMs > curMs) {
            latestBookingByLeadId.set(leadId, historyCandidate);
          }
          if (cMs >= nowMs) {
            const curFuture = futureExperimentalBookingByLeadId.get(leadId);
            const curFutureMs = curFuture
              ? (() => {
                  const v = String((curFuture.professor_start_at || curFuture.lead_start_at) ?? "").trim();
                  if (!v) return 0;
                  const t = new Date(v).getTime();
                  return Number.isFinite(t) && t > 0 ? t : 0;
                })()
              : 0;
            if (curFutureMs <= 0 || (cMs > 0 && cMs < curFutureMs)) {
              futureExperimentalBookingByLeadId.set(leadId, historyCandidate);
            }
          }
        }
      }

      if (eventType === "experimental_class_date_selected" && !draftDateByLeadId.has(leadId)) {
        if (cancelledLeadBookingIds.has(leadId) || cancelledByHistoryLeadIds.has(leadId)) continue;
        draftDateByLeadId.set(leadId, {
          professor_date: String(details.professor_date ?? "").trim(),
          lead_date: String(details.lead_date ?? "").trim(),
          label: String(details.label ?? "").trim() || null,
          at: String(eventCreatedAt ?? ""),
        });
        continue;
      }
      if (eventType === "experimental_class_time_selected" && !draftTimeByLeadId.has(leadId)) {
        if (cancelledLeadBookingIds.has(leadId) || cancelledByHistoryLeadIds.has(leadId)) continue;
        draftTimeByLeadId.set(leadId, {
          professor_date: String(details.professor_date ?? "").trim(),
          professor_time: String(details.professor_time ?? "").trim(),
          lead_date: String(details.lead_date ?? "").trim(),
          lead_time: String(details.lead_time ?? "").trim(),
          professor_start_at: String(details.professor_start_at ?? "").trim(),
          lead_start_at: String(details.lead_start_at ?? "").trim(),
          at: String(eventCreatedAt ?? ""),
        });
        continue;
      }
    }

    for (const [leadId, lessonLink] of lessonLinkByLeadId.entries()) {
      const currentBooking = bookingsByLeadId.get(leadId);
      if (!currentBooking) continue;
      bookingsByLeadId.set(leadId, {
        ...currentBooking,
        lesson_link: lessonLink,
      });
    }

    for (const event of historyEvents ?? []) {
      const leadId = String((event as any)?.lead_id ?? "");
      if (!leadId) continue;
      const details = ((event as any)?.details ?? {}) as Record<string, unknown>;
      const eventType = String((event as any)?.event_type ?? "").trim().toLowerCase();
      const eventCreatedAt = String((event as any)?.created_at ?? "").trim() || null;
      const currentBooking = bookingsByLeadId.get(leadId);
      if (!currentBooking) continue;

      if (
        eventType === "experimental_class_student_start_notification_sent" &&
        !String(currentBooking.student_start_notification_sent_at ?? "").trim()
      ) {
        bookingsByLeadId.set(leadId, {
          ...currentBooking,
          student_start_notification_sent_at: eventCreatedAt,
        });
        continue;
      }

      if (
        eventType === "experimental_class_attendant_start_notification_sent" &&
        !String(currentBooking.attendant_start_notification_sent_at ?? "").trim()
      ) {
        bookingsByLeadId.set(leadId, {
          ...currentBooking,
          attendant_start_notification_sent_at: eventCreatedAt,
        });
        continue;
      }

      if (
        eventType === "experimental_class_attendance_confirmed" &&
        !String(currentBooking.attendance_status ?? "").trim()
      ) {
        bookingsByLeadId.set(leadId, {
          ...currentBooking,
          attendance_status: "attended",
          attendance_checked_at: eventCreatedAt,
        });
        continue;
      }

      if (
        eventType === "experimental_class_attendance_follow_up_required" &&
        !String(currentBooking.attendance_status ?? "").trim()
      ) {
        bookingsByLeadId.set(leadId, {
          ...currentBooking,
          attendance_status: "no_show",
          attendance_checked_at: eventCreatedAt,
        });
      }
    }
  }

  const rows = leadRows
    .map((row) => {
      const leadId = String(row.id ?? "");
      const existingBooking = bookingsByLeadId.get(leadId) ?? null;
      const isCancelledLead = cancelledLeadBookingIds.has(leadId) || cancelledByHistoryLeadIds.has(leadId);
      const cleanDraftDate = isCancelledLead ? null : draftDateByLeadId.get(leadId) ?? null;
      const cleanDraftTime = isCancelledLead ? null : draftTimeByLeadId.get(leadId) ?? null;
      const mergedRowExperimentalClassStatus = isCancelledLead
        ? ""
        : String((row as any)?.experimental_class_status ?? "").trim();

      const mergedProfessorDate = isCancelledLead
        ? ""
        : String((row as any)?.experimental_class_professor_date ?? "").trim() ||
          (cleanDraftTime?.professor_date ?? "") ||
          (cleanDraftDate?.professor_date ?? "") ||
          String((existingBooking as any)?.professor_date ?? "").trim();
      const mergedLeadDate = isCancelledLead
        ? ""
        : String((row as any)?.experimental_class_lead_date ?? "").trim() ||
          (cleanDraftTime?.lead_date ?? "") ||
          (cleanDraftDate?.lead_date ?? "") ||
          String((existingBooking as any)?.lead_date ?? "").trim();
      const mergedProfessorTime = isCancelledLead
        ? ""
        : String((row as any)?.experimental_class_professor_time ?? "").trim() ||
          (cleanDraftTime?.professor_time ?? "") ||
          String((existingBooking as any)?.professor_time ?? "").trim();
      const mergedLeadTime = isCancelledLead
        ? ""
        : String((row as any)?.experimental_class_lead_time ?? "").trim() ||
          (cleanDraftTime?.lead_time ?? "") ||
          String((existingBooking as any)?.lead_time ?? "").trim();
      const mergedProfessorStartAt = isCancelledLead
        ? ""
        : String((row as any)?.experimental_class_professor_start_at ?? "").trim() ||
          (cleanDraftTime?.professor_start_at ?? "") ||
          String((existingBooking as any)?.professor_start_at ?? "").trim();
      const mergedLeadStartAt = isCancelledLead
        ? ""
        : String((row as any)?.experimental_class_lead_start_at ?? "").trim() ||
          (cleanDraftTime?.lead_start_at ?? "") ||
          String((existingBooking as any)?.lead_start_at ?? "").trim();
      const mergedStatus = isCancelledLead
        ? ""
        : mergedRowExperimentalClassStatus ||
          (existingBooking ? "booked" : cleanDraftTime ? "time_selected" : cleanDraftDate ? "date_selected" : "");

      const bookingWithFallback = existingBooking
        ? existingBooking
        : !isCancelledLead && mergedStatus && (mergedProfessorDate || mergedProfessorTime)
          ? ({
              id: "",
              status: "draft",
              lesson_link: null,
              student_start_notification_sent_at: null,
              attendant_start_notification_sent_at: null,
              attendance_status: null,
              attendance_checked_at: null,
              professor_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
              lead_timezone: String((row as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
              professor_date: mergedProfessorDate,
              professor_time: mergedProfessorTime,
              professor_start_at: mergedProfessorStartAt,
              lead_date: mergedLeadDate,
              lead_time: mergedLeadTime,
              lead_start_at: mergedLeadStartAt,
              conversation_id: String((row as any)?.conversation_id ?? ""),
              created_at: String(row.updated_at ?? row.created_at ?? ""),
              source: "draft",
              draft_stage: mergedStatus,
            } as any)
          : null;

      const futureExpBooking = futureExperimentalBookingByLeadId.get(leadId) ?? null;
      const latestPastExpBooking = latestBookingByLeadId.get(leadId) ?? null;
      const recWeekdayRaw = String((row as any)?.recurring_class_weekday ?? "").trim().toLowerCase();
      const recWeekdayOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recWeekdayRaw);
      const recTimeOk =
        Boolean(String((row as any)?.recurring_class_professor_time ?? "").trim()) ||
        Boolean(String((row as any)?.recurring_class_lead_time ?? "").trim());

      let latestPastClassMeta: { date: string; time: string; startAtMs: number } | null = null;
      if (recWeekdayOk && recTimeOk) {
        try {
          const recOcc = calculatePastRecurringOccurrences({
            weekday: recWeekdayRaw as any,
            professorTimeHHMM: String((row as any)?.recurring_class_professor_time ?? "").trim() || String((row as any)?.recurring_class_lead_time ?? "").trim(),
            professorTimeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
            leadTimeZone: String((row as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
            fromDate: String((row as any)?.recurring_class_created_at ?? row.created_at ?? "").trim(),
          });
          const lastRec = recOcc[0] ?? null;
          const recMs = lastRec ? Number(lastRec.professorStartAt ?? 0) : 0;
          const expMs = latestPastExpBooking
            ? parseStartAtMs(latestPastExpBooking.professor_start_at || latestPastExpBooking.lead_start_at)
            : 0;
          if (recMs > 0 && recMs >= expMs && lastRec) {
            latestPastClassMeta = {
              date: String(lastRec.professorDate ?? ""),
              time: String(lastRec.professorTime ?? ""),
              startAtMs: recMs,
            };
          } else if (expMs > 0 && latestPastExpBooking) {
            latestPastClassMeta = {
              date: String(latestPastExpBooking.professor_date ?? latestPastExpBooking.lead_date ?? ""),
              time: String(latestPastExpBooking.professor_time ?? latestPastExpBooking.lead_time ?? ""),
              startAtMs: expMs,
            };
          }
        } catch {
          const expMs = latestPastExpBooking
            ? parseStartAtMs(latestPastExpBooking.professor_start_at || latestPastExpBooking.lead_start_at)
            : 0;
          if (expMs > 0 && latestPastExpBooking) {
            latestPastClassMeta = {
              date: String(latestPastExpBooking.professor_date ?? latestPastExpBooking.lead_date ?? ""),
              time: String(latestPastExpBooking.professor_time ?? latestPastExpBooking.lead_time ?? ""),
              startAtMs: expMs,
            };
          }
        }
      } else if (latestPastExpBooking) {
        const expMs = parseStartAtMs(latestPastExpBooking.professor_start_at || latestPastExpBooking.lead_start_at);
        if (expMs > 0) {
          latestPastClassMeta = {
            date: String(latestPastExpBooking.professor_date ?? latestPastExpBooking.lead_date ?? ""),
            time: String(latestPastExpBooking.professor_time ?? latestPastExpBooking.lead_time ?? ""),
            startAtMs: expMs,
          };
        }
      }

      return {
        ...row,
        experimental_class_professor_date: mergedProfessorDate || null,
        experimental_class_lead_date: mergedLeadDate || null,
        experimental_class_professor_time: mergedProfessorTime || null,
        experimental_class_lead_time: mergedLeadTime || null,
        experimental_class_professor_start_at: mergedProfessorStartAt || null,
        experimental_class_lead_start_at: mergedLeadStartAt || null,
        experimental_class_status: mergedStatus || null,
        conversation: conversationsByLeadId.get(leadId) ?? null,
        experimental_class_booking: bookingWithFallback,
        latest_experimental_class_booking: latestPastExpBooking,
        future_experimental_class_booking: futureExpBooking,
        latest_past_class_meta: latestPastClassMeta,
        latest_experimental_class_cancelled_at: cancelledAtByLeadId.get(leadId) ?? null,
        latest_experimental_class_event: latestClassEventByLeadId.get(leadId) ?? null,
      };
    })
    .filter((row) => {
    const name = String(row.full_name ?? "").toLowerCase();
    const phone = String(row.phone ?? "").toLowerCase();
    const cpf = String(row.cpf ?? "").toLowerCase();
    if (q && !name.includes(q) && !phone.includes(q) && !cpf.includes(q)) return false;
    if (status && String(row.status ?? "").toLowerCase() !== status) return false;
    if (stage && String(row.funnel_stage ?? "").toLowerCase() !== stage) return false;
    if (isZapiInternalBlocklistedPhone(String(row.phone ?? ""))) return false;
    return true;
    })
    .sort((left, right) => {
      const timeDiff = getLeadSortTime(right) - getLeadSortTime(left);
      if (timeDiff !== 0) return timeDiff;
      return new Date(String(right.created_at ?? "")).getTime() - new Date(String(left.created_at ?? "")).getTime();
    });

  return Response.json({ ok: true, leads: rows });
}