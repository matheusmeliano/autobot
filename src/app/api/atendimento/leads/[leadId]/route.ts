import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser, maybeNotifyRegisteredAttendantAboutExperimentalClassScheduled, maybeSendExperimentalClassConfirmationToStudent } from "@/lib/atendimento/server";
import { isAtendimentoOnlyAccessScope, normalizeAccessScope } from "@/lib/auth/access";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import { calculatePastRecurringOccurrences } from "@/lib/atendimento/experimentalClass";
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

function isRelationMissingError(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "").toLowerCase();
  if (code === "42P01") return true;
  return /relation .* does not exist/.test(message) || /could not find the table .* in the schema cache/.test(message);
}

function isUndefinedColumnError(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  if (code === "42703") return true;
  const msg = String(error instanceof Error ? error.message : (error as any)?.message ?? "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
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

function datePlusNDaysIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseStartAtMs(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) && t > 0 ? t : 0;
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

    const nowMs = Date.now();

    let bookings: any[] | null = null;
    let bookingsError: any = null;
    const bookingsSelectWithLessonLink =
      "id, lead_id, status, lesson_link, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, attendance_status, student_start_notification_sent_at, attendant_start_notification_sent_at, created_at, updated_at";
    const bookingsSelectWithoutLessonLink =
      "id, lead_id, status, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, attendance_status, student_start_notification_sent_at, attendant_start_notification_sent_at, created_at, updated_at";
    try {
      const bookingsWithLessonLinkResult = await admin
        .from("atendimento_experimental_class_bookings")
        .select(bookingsSelectWithLessonLink)
        .eq("lead_id", leadId)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false });
      if (bookingsWithLessonLinkResult.error && isExperimentalClassBookingsLessonLinkColumnUnavailable(bookingsWithLessonLinkResult.error)) {
        const bookingsWithoutLessonLinkResult = await admin
          .from("atendimento_experimental_class_bookings")
          .select(bookingsSelectWithoutLessonLink)
          .eq("lead_id", leadId)
          .order("updated_at", { ascending: false })
          .order("created_at", { ascending: false });
        bookings = bookingsWithoutLessonLinkResult.data as any[] | null;
        bookingsError = bookingsWithoutLessonLinkResult.error;
      } else {
        bookings = bookingsWithLessonLinkResult.data as any[] | null;
        bookingsError = bookingsWithLessonLinkResult.error;
      }
    } catch (e) {
      bookingsError = e;
    }
    if (bookingsError && !isExperimentalClassBookingsTableUnavailable(bookingsError)) {
      return Response.json({ ok: false, error: String((bookingsError as any)?.message ?? bookingsError) }, { status: 500 });
    }

    const bookingsById = new Map<string, any>();
    let preferredBooking: any = null;
    let existingBookingRaw: any = null;
    let existingIncludingCancelled: any = null;
    let futureExpBooking: any = null;
    let latestPastExpBooking: any = null;
    let isCancelledFromTable = false;

    for (const b of bookings ?? []) {
      const id = String((b as any)?.id ?? "");
      const status = String((b as any)?.status ?? "").trim().toLowerCase();
      const candidate = {
        ...(b as any),
        lesson_link: String((b as any)?.lesson_link ?? "").trim() || null,
        student_start_notification_sent_at: String((b as any)?.student_start_notification_sent_at ?? "").trim() || null,
        attendant_start_notification_sent_at: String((b as any)?.attendant_start_notification_sent_at ?? "").trim() || null,
        attendance_status: String((b as any)?.attendance_status ?? "").trim() || null,
        attendance_checked_at: null,
        professor_timezone: String((b as any)?.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
        source: "table",
      };
      if (id) bookingsById.set(id, candidate);
      const curIncludingStr = String(
        (existingIncludingCancelled as any)?.updated_at || (existingIncludingCancelled as any)?.created_at || "",
      );
      const newStr = String((b as any).updated_at || (b as any).created_at || "");
      if (!existingIncludingCancelled || newStr > curIncludingStr) {
        existingIncludingCancelled = candidate;
      }
      if (status === "cancelled") {
        isCancelledFromTable = true;
        continue;
      }
      if (!["scheduled", "booked", "attended", "no_show", "completed"].includes(status)) continue;
      if (!existingBookingRaw) existingBookingRaw = candidate;
    }

    const preferredBookingId = String((lead as any)?.experimental_class_booking_id ?? "").trim();
    if (preferredBookingId) {
      preferredBooking = bookingsById.get(preferredBookingId) ?? null;
    }
    existingBookingRaw = preferredBooking ?? existingBookingRaw ?? existingIncludingCancelled ?? null;

    for (const b of bookings ?? []) {
      const status = String((b as any)?.status ?? "").trim().toLowerCase();
      if (status === "cancelled") continue;
      if (!["scheduled", "booked", "attended", "no_show", "completed"].includes(status)) continue;
      const cMs = parseStartAtMs((b as any).professor_start_at || (b as any).lead_start_at);
      if (cMs >= nowMs) {
        const curFutureMs = futureExpBooking
          ? parseStartAtMs(futureExpBooking.professor_start_at || futureExpBooking.lead_start_at)
          : 0;
        if (curFutureMs <= 0 || (cMs > 0 && cMs < curFutureMs)) {
          futureExpBooking = {
            ...(b as any),
            lesson_link: String((b as any)?.lesson_link ?? "").trim() || null,
            student_start_notification_sent_at: String((b as any)?.student_start_notification_sent_at ?? "").trim() || null,
            attendant_start_notification_sent_at: String((b as any)?.attendant_start_notification_sent_at ?? "").trim() || null,
            attendance_status: String((b as any)?.attendance_status ?? "").trim() || null,
            attendance_checked_at: null,
            professor_timezone: String((b as any)?.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
            source: "table",
          };
        }
      } else if (cMs > 0 && cMs < nowMs) {
        const curPastMs = latestPastExpBooking
          ? parseStartAtMs(latestPastExpBooking.professor_start_at || latestPastExpBooking.lead_start_at)
          : 0;
        if (cMs > curPastMs) {
          latestPastExpBooking = {
            ...(b as any),
            lesson_link: String((b as any)?.lesson_link ?? "").trim() || null,
            student_start_notification_sent_at: String((b as any)?.student_start_notification_sent_at ?? "").trim() || null,
            attendant_start_notification_sent_at: String((b as any)?.attendant_start_notification_sent_at ?? "").trim() || null,
            attendance_status: String((b as any)?.attendance_status ?? "").trim() || null,
            attendance_checked_at: null,
            professor_timezone: String((b as any)?.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
            source: "table",
          };
        }
      }
    }

    let cancelledAt: string | null = null;
    let cancelledProfSnap: {
      name: string; phone: string; leadDate: string; leadTime: string;
      professorDate: string; professorTime: string; leadStartAt: string;
      professorStartAt: string; leadTimezone: string; professorTimezone: string;
      lessonLink: string;
    } | null = null;
    let isCancelledFromHistory = false;
    let latestClassEvent: string | null = null;
    let synthStudentNotif: string | null = null;
    let synthAttendantNotif: string | null = null;
    let synthAttendance: string | null = null;
    let synthAttendanceChecked: string | null = null;
    let historyBookingFromScheduled: any = null;
    const allHistoryForLead = (events ?? []).concat([]);
    try {
      const extraHistory = await admin
        .from("atendimento_history_events")
        .select("id, lead_id, event_type, conversation_id, created_at, details")
        .eq("lead_id", leadId)
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
      if (!extraHistory.error && Array.isArray(extraHistory.data)) {
        for (const e of extraHistory.data) {
          const found = allHistoryForLead.some((x) => String((x as any)?.id ?? "") === String((e as any)?.id ?? ""));
          if (!found) allHistoryForLead.push(e as any);
        }
      }
    } catch (_) { /* ignore */ }

    for (const ev of allHistoryForLead) {
      const eventType = String((ev as any)?.event_type ?? "").trim().toLowerCase();
      const eca = String((ev as any)?.created_at ?? "").trim() || null;
      const details = ((ev as any)?.details ?? {}) as Record<string, unknown>;
      if (eventType === "experimental_class_cancelled") {
        isCancelledFromHistory = true;
        if (!cancelledAt) cancelledAt = String(eca ?? "").trim();
        if (!cancelledProfSnap) {
          const n = String(details?.professor_name_before ?? "").trim();
          const p = String(details?.professor_phone_before ?? "").trim();
          const ld = String(details?.lead_date_before ?? "").trim();
          const lt = String(details?.lead_time_before ?? "").trim();
          const pd = String(details?.professor_date_before ?? "").trim();
          const pt = String(details?.professor_time_before ?? "").trim();
          const lsa = String(details?.lead_start_at_before ?? details?.lead_start_at ?? "").trim();
          const psa = String(details?.professor_start_at_before ?? details?.professor_start_at ?? "").trim();
          const ltz = String(details?.lead_timezone_before ?? details?.lead_timezone ?? "").trim();
          const ptz = String(details?.professor_timezone_before ?? details?.teacher_timezone ?? details?.professor_timezone ?? "").trim();
          const llink = String(details?.lesson_link_before ?? details?.lesson_link ?? "").trim();
          if (n || p || ld || lt || pd || pt || lsa || psa || ltz || ptz || llink) {
            cancelledProfSnap = { name: n, phone: p, leadDate: ld, leadTime: lt, professorDate: pd, professorTime: pt, leadStartAt: lsa, professorStartAt: psa, leadTimezone: ltz, professorTimezone: ptz, lessonLink: llink };
          }
        }
      }
      if (eventType.startsWith("experimental_class_") && !latestClassEvent) {
        latestClassEvent = eventType;
      }
      if (eventType === "experimental_class_student_start_notification_sent" && !synthStudentNotif) {
        synthStudentNotif = eca;
      }
      if (eventType === "experimental_class_attendant_start_notification_sent" && !synthAttendantNotif) {
        synthAttendantNotif = eca;
      }
      if (eventType === "experimental_class_attendance_confirmed" && !synthAttendance) {
        synthAttendance = "attended";
        synthAttendanceChecked = eca;
      }
      if (eventType === "experimental_class_attendance_follow_up_required" && !synthAttendance) {
        synthAttendance = "no_show";
        synthAttendanceChecked = eca;
      }
      if (
        !existingBookingRaw &&
        !historyBookingFromScheduled &&
        eventType === "experimental_class_scheduled" &&
        !isCancelledFromTable &&
        !isCancelledFromHistory
      ) {
        const bookingStatus = String(details.status ?? "").trim().toLowerCase() || "scheduled";
        if (bookingStatus !== "cancelled") {
          historyBookingFromScheduled = {
            id: String((ev as any)?.id ?? ""),
            status: bookingStatus,
            lesson_link: String(details.lesson_link ?? "").trim() || null,
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
            conversation_id: String((ev as any)?.conversation_id ?? ""),
            created_at: String((ev as any)?.created_at ?? ""),
            source: "history",
          };
        }
      }
    }
    if (!existingBookingRaw && historyBookingFromScheduled) {
      existingBookingRaw = historyBookingFromScheduled;
    }
    const isCancelledLead = isCancelledFromTable || isCancelledFromHistory;
    const snapProfName = cancelledProfSnap?.name ?? "";
    const snapProfPhone = cancelledProfSnap?.phone ?? "";
    const snapLeadDate = cancelledProfSnap?.leadDate ?? "";
    const snapLeadTime = cancelledProfSnap?.leadTime ?? "";
    const snapProfessorDate = cancelledProfSnap?.professorDate ?? "";
    const snapProfessorTime = cancelledProfSnap?.professorTime ?? "";
    const snapLeadStartAt = cancelledProfSnap?.leadStartAt ?? "";
    const snapProfessorStartAt = cancelledProfSnap?.professorStartAt ?? "";
    const snapLeadTimezone = cancelledProfSnap?.leadTimezone ?? "";
    const snapProfessorTimezone = cancelledProfSnap?.professorTimezone ?? "";
    const snapLessonLink = cancelledProfSnap?.lessonLink ?? "";

    const existingBooking =
      existingBookingRaw ??
      (isCancelledLead
        ? ({
            id: "",
            status: "cancelled",
            lesson_link: snapLessonLink || null,
            student_start_notification_sent_at: null,
            attendant_start_notification_sent_at: null,
            attendance_status: null,
            attendance_checked_at: null,
            professor_timezone: snapProfessorTimezone || ATENDIMENTO_PROFESSOR_TIME_ZONE,
            lead_timezone:
              snapLeadTimezone ||
              String((lead as any)?.timezone ?? "").trim() ||
              ATENDIMENTO_PROFESSOR_TIME_ZONE,
            professor_date: snapProfessorDate || "",
            professor_time: snapProfessorTime || "",
            professor_start_at: snapProfessorStartAt || "",
            lead_date: snapLeadDate || "",
            lead_time: snapLeadTime || "",
            lead_start_at: snapLeadStartAt || "",
            assigned_professor_name:
              String((lead as any)?.experimental_class_professor_name ?? "").trim() ||
              snapProfName ||
              null,
            assigned_professor_phone:
              String((lead as any)?.experimental_class_professor_phone ?? "").trim() ||
              snapProfPhone ||
              null,
            conversation_id: String((lead as any)?.conversation_id ?? ""),
            created_at: cancelledAt || String((lead as any).updated_at ?? (lead as any).created_at ?? ""),
            updated_at: cancelledAt || String((lead as any).updated_at ?? (lead as any).created_at ?? ""),
            source: "cancelled_history",
            cancelled_action: "deleted_and_unlinked",
          } as any)
        : null);

    const rowExperimentalProfName = String((lead as any)?.experimental_class_professor_name ?? "").trim();
    const rowExperimentalProfPhone = String((lead as any)?.experimental_class_professor_phone ?? "").trim();
    const bookingExpProfName = String((existingBooking as any)?.assigned_professor_name ?? "").trim();
    const bookingExpProfPhone = String((existingBooking as any)?.assigned_professor_phone ?? "").trim();
    const mergedExperimentalProfName = rowExperimentalProfName || bookingExpProfName || snapProfName || "";
    const mergedExperimentalProfPhone = rowExperimentalProfPhone || bookingExpProfPhone || snapProfPhone || "";
    const cleanDraftDate = isCancelledLead ? null : null;
    const cleanDraftTime = isCancelledLead ? null : null;
    const mergedRowExperimentalClassStatus = isCancelledLead
      ? ""
      : String((lead as any)?.experimental_class_status ?? "").trim();
    const mergedProfessorDate =
      String((lead as any)?.experimental_class_professor_date ?? "").trim() ||
      String((existingBooking as any)?.professor_date ?? "").trim() ||
      (isCancelledLead ? snapProfessorDate : "") ||
      (cleanDraftTime?.professor_date ?? "") ||
      (cleanDraftDate?.professor_date ?? "");
    const mergedLeadDate =
      String((lead as any)?.experimental_class_lead_date ?? "").trim() ||
      String((existingBooking as any)?.lead_date ?? "").trim() ||
      (isCancelledLead ? snapLeadDate : "") ||
      (cleanDraftTime?.lead_date ?? "") ||
      (cleanDraftDate?.lead_date ?? "");
    const mergedProfessorTime =
      String((lead as any)?.experimental_class_professor_time ?? "").trim() ||
      String((existingBooking as any)?.professor_time ?? "").trim() ||
      (isCancelledLead ? snapProfessorTime : "") ||
      (cleanDraftTime?.professor_time ?? "");
    const mergedLeadTime =
      String((lead as any)?.experimental_class_lead_time ?? "").trim() ||
      String((existingBooking as any)?.lead_time ?? "").trim() ||
      (isCancelledLead ? snapLeadTime : "") ||
      (cleanDraftTime?.lead_time ?? "");
    const mergedProfessorStartAt =
      String((lead as any)?.experimental_class_professor_start_at ?? "").trim() ||
      String((existingBooking as any)?.professor_start_at ?? "").trim() ||
      (isCancelledLead ? snapProfessorStartAt : "") ||
      (cleanDraftTime?.professor_start_at ?? "");
    const mergedLeadStartAt =
      String((lead as any)?.experimental_class_lead_start_at ?? "").trim() ||
      String((existingBooking as any)?.lead_start_at ?? "").trim() ||
      (isCancelledLead ? snapLeadStartAt : "") ||
      (cleanDraftTime?.lead_start_at ?? "");
    const mergedStatus = isCancelledLead
      ? ""
      : mergedRowExperimentalClassStatus ||
        (existingBooking ? "booked" : cleanDraftTime ? "time_selected" : cleanDraftDate ? "date_selected" : "");

    const recWeekdayRaw = String((lead as any)?.recurring_class_weekday ?? "").trim().toLowerCase();
    const recWeekdayOk = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(recWeekdayRaw);
    const recWeekdayLabel = String((lead as any)?.recurring_class_weekday_label ?? "").trim();
    const recWeekdayLabelOk =
      /segunda|terça|terca|quarta|quinta|sexta|sabado|sábado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(recWeekdayLabel);
    const hasRecWeekdayAny = recWeekdayOk || recWeekdayLabelOk;
    const recTimeOk =
      Boolean(String((lead as any)?.recurring_class_professor_time ?? "").trim()) ||
      Boolean(String((lead as any)?.recurring_class_lead_time ?? "").trim());

    const bookingWithFallback = existingBooking
      ? existingBooking
      : (!isCancelledLead && mergedStatus && (mergedProfessorDate || mergedProfessorTime))
        ? ({
            id: "",
            status: (hasRecWeekdayAny && recTimeOk) ? "booked" : "draft",
            lesson_link: null,
            student_start_notification_sent_at: synthStudentNotif,
            attendant_start_notification_sent_at: synthAttendantNotif,
            attendance_status: synthAttendance,
            attendance_checked_at: synthAttendanceChecked,
            professor_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
            lead_timezone: String((lead as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
            professor_date: mergedProfessorDate,
            professor_time: mergedProfessorTime,
            professor_start_at: mergedProfessorStartAt,
            lead_date: mergedLeadDate,
            lead_time: mergedLeadTime,
            lead_start_at: mergedLeadStartAt,
            conversation_id: String((lead as any)?.conversation_id ?? ""),
            created_at: String((lead as any).updated_at ?? (lead as any).created_at ?? ""),
            source: (hasRecWeekdayAny && recTimeOk) ? "manual" : "draft",
            draft_stage: mergedStatus,
            assigned_professor_name: mergedExperimentalProfName || null,
            assigned_professor_phone: mergedExperimentalProfPhone || null,
          } as any)
          : (hasRecWeekdayAny && recTimeOk)
            ? ({
                id: "",
                status: "booked",
                lesson_link: null,
                student_start_notification_sent_at: synthStudentNotif,
                attendant_start_notification_sent_at: synthAttendantNotif,
                attendance_status: synthAttendance,
                attendance_checked_at: synthAttendanceChecked,
                professor_timezone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
                lead_timezone: String((lead as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
                professor_date: datePlusNDaysIso(3),
                professor_time: String((lead as any)?.recurring_class_professor_time ?? (lead as any)?.recurring_class_lead_time ?? "08:00").trim(),
                professor_start_at: "",
                lead_date: datePlusNDaysIso(3),
                lead_time: String((lead as any)?.recurring_class_lead_time ?? (lead as any)?.recurring_class_professor_time ?? "08:00").trim(),
                lead_start_at: "",
                conversation_id: String((lead as any)?.conversation_id ?? ""),
                created_at: String((lead as any).updated_at ?? (lead as any).created_at ?? ""),
                source: "manual",
                draft_stage: "",
              } as any)
            : null;

    let latestPastClassMeta: { date: string; time: string; startAtMs: number } | null = null;
    if (recWeekdayOk && recTimeOk) {
      try {
        const recOcc = calculatePastRecurringOccurrences({
          weekday: recWeekdayRaw as any,
          professorTimeHHMM: String((lead as any)?.recurring_class_professor_time ?? "").trim() || String((lead as any)?.recurring_class_lead_time ?? "").trim(),
          professorTimeZone: ATENDIMENTO_PROFESSOR_TIME_ZONE,
          leadTimeZone: String((lead as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
          fromDate: String((lead as any)?.recurring_class_created_at ?? (lead as any).created_at ?? "").trim(),
        });
        const lastRec = recOcc[0] ?? null;
        const recMs = lastRec ? Number((lastRec as any).professorStartAt ?? 0) : 0;
        const expMs = latestPastExpBooking
          ? parseStartAtMs(latestPastExpBooking.professor_start_at || latestPastExpBooking.lead_start_at)
          : 0;
        if (recMs > 0 && recMs >= expMs && lastRec) {
          latestPastClassMeta = {
            date: String((lastRec as any).professorDate ?? ""),
            time: String((lastRec as any).professorTime ?? ""),
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

    const finalBookingForField = bookingWithFallback
      ? {
          ...bookingWithFallback,
          assigned_professor_name: (bookingWithFallback as any).assigned_professor_name || mergedExperimentalProfName || null,
          assigned_professor_phone: (bookingWithFallback as any).assigned_professor_phone || mergedExperimentalProfPhone || null,
        }
      : null;

    return Response.json({
      ok: true,
      lead: {
        ...(lead as any),
        is_new_for_attendant: (lead as any)?.is_new_for_attendant ?? false,
        conversation: conversation ?? null,
        experimental_class_booking: finalBookingForField,
        latest_experimental_class_booking: existingBookingRaw ?? existingBooking ?? null,
        future_experimental_class_booking: futureExpBooking,
        latest_past_class_meta: latestPastClassMeta,
        latest_experimental_class_cancelled_at: cancelledAt,
        latest_experimental_class_event: latestClassEvent,
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
    recurring_class_link: z.string().trim().max(500).nullable().optional(),
    city: z.string().trim().max(160).nullable().optional(),
    state: z.string().trim().max(160).nullable().optional(),
    country: z.string().trim().max(120).nullable().optional(),
    timezone: z.string().trim().max(120).nullable().optional(),
    funnel_stage: z.string().trim().max(120).nullable().optional(),
    experimental_class_status: z.string().trim().max(120).nullable().optional(),
    experimental_class_lead_date: z.string().trim().max(40).nullable().optional(),
    experimental_class_lead_time: z.string().trim().max(20).nullable().optional(),
    experimental_class_professor_date: z.string().trim().max(40).nullable().optional(),
    experimental_class_professor_time: z.string().trim().max(20).nullable().optional(),
    experimental_class_lead_start_at: z.string().trim().max(80).nullable().optional(),
    experimental_class_professor_start_at: z.string().trim().max(80).nullable().optional(),
    experimental_class_link: z.string().trim().max(500).nullable().optional(),
    experimental_class_professor_name: z.string().trim().max(160).nullable().optional(),
    experimental_class_professor_phone: z.string().trim().max(40).nullable().optional(),
    experimental_class_booking_id: z.string().trim().max(120).nullable().optional(),
    internal_notes: z.string().max(5000).nullable().optional(),
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

  const recurringLinkRaw = parsed.data.recurring_class_link;
  let safeRecurringLink: undefined | null | string = undefined;
  if (recurringLinkRaw === undefined) {
    safeRecurringLink = undefined;
  } else if (recurringLinkRaw === null) {
    safeRecurringLink = null;
  } else {
    const trimmed = String(recurringLinkRaw).trim();
    if (/^https?:\/\//i.test(trimmed)) {
      safeRecurringLink = trimmed;
    } else if (trimmed.length === 0) {
      safeRecurringLink = null;
    } else {
      safeRecurringLink = null;
    }
  }

  const cityRaw = parsed.data.city;
  const safeCity =
    cityRaw === undefined
      ? undefined
      : cityRaw === null
        ? null
        : String(cityRaw).trim() || null;

  const stateRaw = parsed.data.state;
  const safeState =
    stateRaw === undefined
      ? undefined
      : stateRaw === null
        ? null
        : String(stateRaw).trim() || null;

  const countryRaw = parsed.data.country;
  let safeCountry: undefined | null | string = undefined;
  if (countryRaw === undefined) {
    safeCountry = undefined;
  } else if (countryRaw === null) {
    safeCountry = null;
  } else {
    safeCountry = String(countryRaw).trim() || null;
  }

  const timezoneRaw = parsed.data.timezone;
  let safeTimezone: undefined | null | string = undefined;
  if (timezoneRaw === undefined) {
    safeTimezone = undefined;
  } else if (timezoneRaw === null) {
    safeTimezone = null;
  } else {
    safeTimezone = String(timezoneRaw).trim() || null;
  }

  function normalizeLocationKey(value: unknown): string {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  }

  const hasCityOrStateIncoming =
    (safeCity !== undefined && safeCity !== null) ||
    (safeState !== undefined && safeState !== null);

  if (hasCityOrStateIncoming) {
    const normState = normalizeLocationKey(safeState ?? "");
    const normCity = normalizeLocationKey(safeCity ?? "");

    const usStateCodes = new Set<string>([
      "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc",
    ]);

    const usStateNameToCode: Record<string, string> = {
      alabama: "al",
      alaska: "ak",
      arizona: "az",
      arkansas: "ar",
      california: "ca",
      colorado: "co",
      connecticut: "ct",
      delaware: "de",
      florida: "fl",
      georgia: "ga",
      hawaii: "hi",
      idaho: "id",
      illinois: "il",
      indiana: "in",
      iowa: "ia",
      kansas: "ks",
      kentucky: "ky",
      louisiana: "la",
      maine: "me",
      maryland: "md",
      massachusetts: "ma",
      michigan: "mi",
      minnesota: "mn",
      mississippi: "ms",
      missouri: "mo",
      montana: "mt",
      nebraska: "ne",
      nevada: "nv",
      newhampshire: "nh",
      newjersey: "nj",
      newmexico: "nm",
      newyork: "ny",
      northcarolina: "nc",
      northdakota: "nd",
      ohio: "oh",
      oklahoma: "ok",
      oregon: "or",
      pennsylvania: "pa",
      rhodeisland: "ri",
      southcarolina: "sc",
      southdakota: "sd",
      tennessee: "tn",
      texas: "tx",
      utah: "ut",
      vermont: "vt",
      virginia: "va",
      washington: "wa",
      westvirginia: "wv",
      wisconsin: "wi",
      wyoming: "wy",
      districtofcolumbia: "dc",
    };

    const usStateCodeToTimezone: Record<string, string> = {
      al: "America/Chicago",
      ak: "America/Anchorage",
      az: "America/Phoenix",
      ar: "America/Chicago",
      ca: "America/Los_Angeles",
      co: "America/Denver",
      ct: "America/New_York",
      de: "America/New_York",
      fl: "America/New_York",
      ga: "America/New_York",
      hi: "Pacific/Honolulu",
      id: "America/Boise",
      il: "America/Chicago",
      in: "America/Indiana/Indianapolis",
      ia: "America/Chicago",
      ks: "America/Chicago",
      ky: "America/New_York",
      la: "America/Chicago",
      me: "America/New_York",
      md: "America/New_York",
      ma: "America/New_York",
      mi: "America/Detroit",
      mn: "America/Chicago",
      ms: "America/Chicago",
      mo: "America/Chicago",
      mt: "America/Denver",
      ne: "America/Chicago",
      nv: "America/Los_Angeles",
      nh: "America/New_York",
      nj: "America/New_York",
      nm: "America/Denver",
      ny: "America/New_York",
      nc: "America/New_York",
      nd: "America/Chicago",
      oh: "America/New_York",
      ok: "America/Chicago",
      or: "America/Los_Angeles",
      pa: "America/New_York",
      ri: "America/New_York",
      sc: "America/New_York",
      sd: "America/Chicago",
      tn: "America/Chicago",
      tx: "America/Chicago",
      ut: "America/Denver",
      vt: "America/New_York",
      va: "America/New_York",
      wa: "America/Los_Angeles",
      wv: "America/New_York",
      wi: "America/Chicago",
      wy: "America/Denver",
      dc: "America/New_York",
    };

    const brStateToTimezone: Record<string, string> = {
      ac: "America/Rio_Branco",
      al: "America/Maceio",
      ap: "America/Belem",
      am: "America/Manaus",
      ba: "America/Bahia",
      ce: "America/Fortaleza",
      df: "America/Sao_Paulo",
      es: "America/Sao_Paulo",
      go: "America/Sao_Paulo",
      ma: "America/Sao_Paulo",
      mt: "America/Cuiaba",
      ms: "America/Campo_Grande",
      mg: "America/Sao_Paulo",
      pa: "America/Belem",
      pb: "America/Fortaleza",
      pr: "America/Sao_Paulo",
      pe: "America/Recife",
      pi: "America/Fortaleza",
      rj: "America/Sao_Paulo",
      rn: "America/Fortaleza",
      rs: "America/Sao_Paulo",
      ro: "America/Porto_Velho",
      rr: "America/Boa_Vista",
      sc: "America/Sao_Paulo",
      sp: "America/Sao_Paulo",
      se: "America/Maceio",
      to: "America/Araguaina",
    };

    const brStateByNameToCode: Record<string, string> = {
      acre: "ac",
      alagoas: "al",
      amapa: "ap",
      amazonas: "am",
      bahia: "ba",
      ceara: "ce",
      distritofederal: "df",
      espiritosanto: "es",
      goias: "go",
      maranhao: "ma",
      matogrosso: "mt",
      matogrossodosul: "ms",
      minasgerais: "mg",
      para: "pa",
      paraiba: "pb",
      parana: "pr",
      pernambuco: "pe",
      piaui: "pi",
      riodejaneiro: "rj",
      riograndedonorte: "rn",
      riograndedosul: "rs",
      rondonia: "ro",
      roraima: "rr",
      santacatarina: "sc",
      saopaulo: "sp",
      sergipe: "se",
      tocantins: "to",
    };

    let usCode = normState.length === 2 ? (usStateCodes.has(normState) ? normState : "") : "";
    if (!usCode && normState) {
      usCode = usStateNameToCode[normState] ?? "";
    }

    let brCode = normState.length === 2 ? (brStateByNameToCode[normState] ? normState : "") : "";
    if (!brCode && normState) {
      brCode = brStateByNameToCode[normState] ?? "";
    }

    let derivedCountry: string | null = null;
    let derivedTimezone: string | null = null;

    if (usCode) {
      derivedCountry = "Estados Unidos";
      derivedTimezone = usStateCodeToTimezone[usCode] ?? "America/New_York";
    } else if (brCode) {
      derivedCountry = "Brasil";
      derivedTimezone = brStateToTimezone[brCode] ?? "America/Cuiaba";
    } else {
      if (normState) {
        if (
          normState.includes("florida") ||
          normState.includes("california") ||
          normState.includes("texas") ||
          normState.includes("newyork") ||
          normState.includes("washington") ||
          normState.includes("illinois") ||
          normState.includes("pensilvania") ||
          normState.includes("pennsylvania") ||
          normState.includes("ohio") ||
          normState.includes("georgia") ||
          normState.includes("northcarolina") ||
          normState.includes("michigan") ||
          normState.includes("newjersey") ||
          normState.includes("virginia") ||
          normState.includes("arizona") ||
          normState.includes("massachusetts") ||
          normState.includes("tennessee") ||
          normState.includes("indiana") ||
          normState.includes("missouri") ||
          normState.includes("maryland") ||
          normState.includes("wisconsin") ||
          normState.includes("colorado") ||
          normState.includes("minnesota") ||
          normState.includes("southcarolina") ||
          normState.includes("alabama") ||
          normState.includes("louisiana") ||
          normState.includes("kentucky") ||
          normState.includes("oregon") ||
          normState.includes("oklahoma") ||
          normState.includes("connecticut") ||
          normState.includes("nevada") ||
          normState.includes("arkansas") ||
          normState.includes("mississippi") ||
          normState.includes("kansas") ||
          normState.includes("newmexico") ||
          normState.includes("nebraska") ||
          normState.includes("westvirginia") ||
          normState.includes("idaho") ||
          normState.includes("hawaii") ||
          normState.includes("newhampshire") ||
          normState.includes("maine") ||
          normState.includes("rhodeisland") ||
          normState.includes("delaware") ||
          normState.includes("southdakota") ||
          normState.includes("northdakota") ||
          normState.includes("montana") ||
          normState.includes("vermont") ||
          normState.includes("wyoming") ||
          normState.includes("alaska")
        ) {
          derivedCountry = "Estados Unidos";
        } else if (
          normState.includes("portugal") ||
          normCity.includes("lisboa") ||
          normCity.includes("lisbon") ||
          normCity.includes("porto")
        ) {
          derivedCountry = "Portugal";
          derivedTimezone = "Europe/Lisbon";
        } else if (
          normState.includes("espanha") ||
          normState.includes("spain") ||
          normCity.includes("madrid") ||
          normCity.includes("barcelona")
        ) {
          derivedCountry = "Espanha";
          derivedTimezone = "Europe/Madrid";
        } else if (
          normState.includes("paraguai") ||
          normState.includes("paraguay") ||
          normCity.includes("asuncion") ||
          normCity.includes("assunca")
        ) {
          derivedCountry = "Paraguai";
          derivedTimezone = "America/Asuncion";
        } else if (
          normState.includes("argentina") ||
          normCity.includes("buenosaires")
        ) {
          derivedCountry = "Argentina";
          derivedTimezone = "America/Argentina/Buenos_Aires";
        }
      }

      if (!derivedCountry && normCity) {
        if (
          normCity.includes("miami") ||
          normCity.includes("orlando") ||
          normCity.includes("newyork") ||
          normCity.includes("losangeles") ||
          normCity.includes("lasvegas") ||
          normCity.includes("sanfrancisco") ||
          normCity.includes("sandiego") ||
          normCity.includes("chicago") ||
          normCity.includes("houston") ||
          normCity.includes("dallas") ||
          normCity.includes("austin") ||
          normCity.includes("seattle") ||
          normCity.includes("boston") ||
          normCity.includes("philadelphia") ||
          normCity.includes("phoenix") ||
          normCity.includes("denver") ||
          normCity.includes("atlanta") ||
          normCity.includes("detroit") ||
          normCity.includes("washington") ||
          normCity.includes("portland") ||
          normCity.includes("saltlakecity")
        ) {
          derivedCountry = "Estados Unidos";
        } else if (
          normCity.includes("lisboa") ||
          normCity.includes("lisbon") ||
          normCity.includes("porto")
        ) {
          derivedCountry = "Portugal";
          derivedTimezone = "Europe/Lisbon";
        } else if (normCity.includes("madrid") || normCity.includes("barcelona")) {
          derivedCountry = "Espanha";
          derivedTimezone = "Europe/Madrid";
        } else if (normCity.includes("asuncion") || normCity.includes("assunca")) {
          derivedCountry = "Paraguai";
          derivedTimezone = "America/Asuncion";
        } else if (normCity.includes("buenosaires")) {
          derivedCountry = "Argentina";
          derivedTimezone = "America/Argentina/Buenos_Aires";
        }
      }
    }

    if (!derivedCountry) {
      derivedCountry = "Brasil";
    }
    const normCountry = normalizeLocationKey(derivedCountry);

    if (!derivedTimezone) {
      if (normCountry === "estadosunidos") {
        if (
          normCity.includes("miami") ||
          normState === "fl" ||
          normState.includes("florida") ||
          normCity.includes("newyork") ||
          normState === "ny" ||
          normState.includes("newyork") ||
          normCity.includes("boston") ||
          normCity.includes("philadelphia") ||
          normCity.includes("washington") ||
          normCity.includes("atlanta")
        ) {
          derivedTimezone = "America/New_York";
        } else if (
          normCity.includes("losangeles") ||
          normState === "ca" ||
          normState.includes("california") ||
          normCity.includes("lasvegas") ||
          normCity.includes("sanfrancisco") ||
          normCity.includes("sandiego") ||
          normCity.includes("seattle") ||
          normCity.includes("portland") ||
          normState === "wa" ||
          normState.includes("washington") ||
          normState === "nv" ||
          normState.includes("nevada") ||
          normState === "or" ||
          normState.includes("oregon")
        ) {
          derivedTimezone = "America/Los_Angeles";
        } else if (
          normCity.includes("chicago") ||
          normState === "il" ||
          normState.includes("illinois") ||
          normCity.includes("houston") ||
          normCity.includes("dallas") ||
          normCity.includes("austin") ||
          normState === "tx" ||
          normState.includes("texas")
        ) {
          derivedTimezone = "America/Chicago";
        } else if (
          normCity.includes("denver") ||
          normState === "co" ||
          normState.includes("colorado") ||
          normCity.includes("phoenix") ||
          normState === "az" ||
          normState.includes("arizona") ||
          normCity.includes("saltlakecity")
        ) {
          derivedTimezone = "America/Denver";
        } else if (normCity.includes("honolulu") || normState === "hi" || normState.includes("hawaii")) {
          derivedTimezone = "Pacific/Honolulu";
        } else if (normCity.includes("anchorage") || normState === "ak" || normState.includes("alaska")) {
          derivedTimezone = "America/Anchorage";
        } else {
          derivedTimezone = "America/New_York";
        }
      } else if (normCountry === "portugal") {
        derivedTimezone = "Europe/Lisbon";
      } else if (normCountry === "espanha") {
        derivedTimezone = "Europe/Madrid";
      } else if (normCountry === "paraguai") {
        derivedTimezone = "America/Asuncion";
      } else if (normCountry === "argentina") {
        derivedTimezone = "America/Argentina/Buenos_Aires";
      } else {
        if (normCity.includes("saopaulo") || normCity.includes("sao paulo") || normCity.includes("campinas") || normCity.includes("ribeirao")) {
          derivedTimezone = "America/Sao_Paulo";
        } else if (normCity.includes("riodejaneiro") || normCity.includes("rio de janeiro") || normCity.includes("nit")) {
          derivedTimezone = "America/Sao_Paulo";
        } else if (normCity.includes("cuiaba")) {
          derivedTimezone = "America/Cuiaba";
        } else if (normCity.includes("campogrande")) {
          derivedTimezone = "America/Campo_Grande";
        } else if (normCity.includes("manaus")) {
          derivedTimezone = "America/Manaus";
        } else if (normCity.includes("belem") || normCity.includes("anapolis")) {
          derivedTimezone = "America/Belem";
        } else if (
          normCity.includes("recife") ||
          normCity.includes("fortaleza") ||
          normCity.includes("salvador") ||
          normCity.includes("maceio") ||
          normCity.includes("natal") ||
          normCity.includes("joaopessoa") ||
          normCity.includes("teresina")
        ) {
          derivedTimezone = "America/Fortaleza";
        } else if (
          normCity.includes("portoalegre") ||
          normCity.includes("curitiba") ||
          normCity.includes("florianopolis") ||
          normCity.includes("joinville") ||
          normCity.includes("blumenau")
        ) {
          derivedTimezone = "America/Sao_Paulo";
        } else if (
          normCity.includes("belohorizonte") ||
          normCity.includes("juizdefora") ||
          normCity.includes("uberlandia")
        ) {
          derivedTimezone = "America/Sao_Paulo";
        } else if (normCity.includes("brasilia")) {
          derivedTimezone = "America/Sao_Paulo";
        } else if (normCity.includes("portovelho")) {
          derivedTimezone = "America/Porto_Velho";
        } else if (normCity.includes("riobranco")) {
          derivedTimezone = "America/Rio_Branco";
        } else if (normCity.includes("boa vista") || normCity.includes("boavista")) {
          derivedTimezone = "America/Boa_Vista";
        } else if (normCity.includes("palmas") || normCity.includes("araguaina")) {
          derivedTimezone = "America/Araguaina";
        } else {
          derivedTimezone = "America/Cuiaba";
        }
      }
    }

    if (safeCountry === undefined && derivedCountry) {
      safeCountry = derivedCountry;
    }
    if (safeTimezone === undefined && derivedTimezone) {
      safeTimezone = derivedTimezone;
    }
  }

  const funnelStageRaw = parsed.data.funnel_stage;
  let safeFunnelStage: undefined | null | string = undefined;
  if (funnelStageRaw === undefined) {
    safeFunnelStage = undefined;
  } else if (funnelStageRaw === null) {
    safeFunnelStage = null;
  } else {
    safeFunnelStage = String(funnelStageRaw).trim() || null;
  }

  const expStatusRaw = parsed.data.experimental_class_status;
  let safeExpStatus: undefined | null | string = undefined;
  if (expStatusRaw === undefined) {
    safeExpStatus = undefined;
  } else if (expStatusRaw === null) {
    safeExpStatus = null;
  } else {
    safeExpStatus = String(expStatusRaw).trim() || null;
  }

  function toSafeStringTrimOrNull<T>(value: T | undefined | null): undefined | null | string {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const s = String(value).trim();
    return s.length === 0 ? null : s;
  }

  const safeExpLeadDate = toSafeStringTrimOrNull(parsed.data.experimental_class_lead_date);
  const safeExpLeadTime = toSafeStringTrimOrNull(parsed.data.experimental_class_lead_time);
  const safeExpProfessorDate = toSafeStringTrimOrNull(parsed.data.experimental_class_professor_date);
  const safeExpProfessorTime = toSafeStringTrimOrNull(parsed.data.experimental_class_professor_time);
  const safeExpLeadStartAt = toSafeStringTrimOrNull(parsed.data.experimental_class_lead_start_at);
  const safeExpProfessorStartAt = toSafeStringTrimOrNull(parsed.data.experimental_class_professor_start_at);

  let safeExpLink: undefined | null | string = undefined;
  const expLinkRaw = parsed.data.experimental_class_link;
  if (expLinkRaw === undefined) {
    safeExpLink = undefined;
  } else if (expLinkRaw === null) {
    safeExpLink = null;
  } else {
    const trimmed = String(expLinkRaw).trim();
    if (/^https?:\/\//i.test(trimmed)) {
      safeExpLink = trimmed;
    } else if (trimmed.length === 0) {
      safeExpLink = null;
    } else {
      safeExpLink = null;
    }
  }

  const safeExpProfessorName = toSafeStringTrimOrNull(parsed.data.experimental_class_professor_name);
  const safeExpProfessorPhone = toSafeStringTrimOrNull(parsed.data.experimental_class_professor_phone);
  const safeExpBookingId = toSafeStringTrimOrNull(parsed.data.experimental_class_booking_id);

  const internalNotesRaw = parsed.data.internal_notes;
  let safeInternalNotes: undefined | null | string = undefined;
  if (internalNotesRaw === undefined) {
    safeInternalNotes = undefined;
  } else if (internalNotesRaw === null) {
    safeInternalNotes = null;
  } else {
    safeInternalNotes = String(internalNotesRaw).substring(0, 5000);
  }

  const admin = createSupabaseAdminClient();
  const updateData: Record<string, unknown> = {};
  if (safeFullName !== undefined) updateData.full_name = safeFullName;
  if (safeRecurringLink !== undefined) updateData.recurring_class_link = safeRecurringLink;
  if (safeCity !== undefined) updateData.city = safeCity;
  if (safeState !== undefined) updateData.state = safeState;
  if (safeCountry !== undefined) updateData.country = safeCountry;
  if (safeTimezone !== undefined) updateData.timezone = safeTimezone;
  if (safeFunnelStage !== undefined) updateData.funnel_stage = safeFunnelStage;
  if (safeExpStatus !== undefined) updateData.experimental_class_status = safeExpStatus;
  if (safeExpLeadDate !== undefined) updateData.experimental_class_lead_date = safeExpLeadDate;
  if (safeExpLeadTime !== undefined) updateData.experimental_class_lead_time = safeExpLeadTime;
  if (safeExpProfessorDate !== undefined) updateData.experimental_class_professor_date = safeExpProfessorDate;
  if (safeExpProfessorTime !== undefined) updateData.experimental_class_professor_time = safeExpProfessorTime;
  if (safeExpLeadStartAt !== undefined) updateData.experimental_class_lead_start_at = safeExpLeadStartAt;
  if (safeExpProfessorStartAt !== undefined) updateData.experimental_class_professor_start_at = safeExpProfessorStartAt;
  if (safeExpLink !== undefined) updateData.experimental_class_link = safeExpLink;
  if (safeExpProfessorName !== undefined) updateData.experimental_class_professor_name = safeExpProfessorName;
  if (safeExpProfessorPhone !== undefined) updateData.experimental_class_professor_phone = safeExpProfessorPhone;
  if (safeExpBookingId !== undefined) updateData.experimental_class_booking_id = safeExpBookingId;
  if (safeInternalNotes !== undefined) updateData.internal_notes = safeInternalNotes;

  if (Object.keys(updateData).length === 0) {
    return Response.json({ ok: true, lead: null });
  }

  const selectFull = "id, full_name, recurring_class_link, city, state, country, timezone, funnel_stage, experimental_class_status, experimental_class_lead_date, experimental_class_lead_time, experimental_class_professor_date, experimental_class_professor_time, experimental_class_lead_start_at, experimental_class_professor_start_at, experimental_class_link, experimental_class_professor_name, experimental_class_professor_phone, experimental_class_booking_id, internal_notes, updated_at";
  const selectSafe = "id, full_name, recurring_class_link, city, state, country, timezone, updated_at";

  let updated: any = null;
  let runErr: any = null;
  {
    const { data: d1, error: e1 } = await admin
      .from("atendimento_leads")
      .update(updateData)
      .eq("id", leadId)
      .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
      .select(selectFull)
      .maybeSingle();
    if (!e1 && d1) {
      updated = d1;
    } else if (e1 && isUndefinedColumnError(e1)) {
      const strippedUpdate: Record<string, unknown> = {};
      for (const k of Object.keys(updateData)) {
        if (k.startsWith("experimental_class_")) continue;
        strippedUpdate[k] = updateData[k];
      }
      if (Object.keys(strippedUpdate).length === 0) {
        const { data: fallbackLead } = await admin
          .from("atendimento_leads")
          .select(selectSafe)
          .eq("id", leadId)
          .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
          .maybeSingle();
        updated = fallbackLead ?? null;
      } else {
        const { data: d2, error: e2 } = await admin
          .from("atendimento_leads")
          .update(strippedUpdate)
          .eq("id", leadId)
          .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
          .select(selectSafe)
          .maybeSingle();
        if (!e2) {
          updated = d2 ?? null;
        } else {
          runErr = e2;
        }
      }
    } else {
      runErr = e1;
    }
  }

  if (runErr) {
    return Response.json({ ok: false, error: runErr.message }, { status: 500 });
  }
  if (!updated?.id) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const touchedScheduleFields =
    Object.prototype.hasOwnProperty.call(updateData, "experimental_class_status") ||
    Object.prototype.hasOwnProperty.call(updateData, "funnel_stage") ||
    Object.prototype.hasOwnProperty.call(updateData, "experimental_class_lead_date") ||
    Object.prototype.hasOwnProperty.call(updateData, "experimental_class_lead_time") ||
    Object.prototype.hasOwnProperty.call(updateData, "experimental_class_professor_date") ||
    Object.prototype.hasOwnProperty.call(updateData, "experimental_class_professor_time") ||
    Object.prototype.hasOwnProperty.call(updateData, "experimental_class_booking_id");
  if (touchedScheduleFields) {
    void maybeNotifyRegisteredAttendantAboutExperimentalClassScheduled({
      leadId,
      leadName: String((updated as any)?.full_name ?? "").trim() || null,
      conversationId: null,
    });
    void maybeSendExperimentalClassConfirmationToStudent({
      leadId,
      leadName: String((updated as any)?.full_name ?? "").trim() || null,
      conversationId: null,
    });
  }

  return Response.json({
    ok: true,
    lead: {
      id: String(updated.id ?? ""),
      full_name: String((updated as any).full_name ?? "").trim() || null,
      recurring_class_link: String((updated as any).recurring_class_link ?? "").trim() || null,
      city: String((updated as any).city ?? "").trim() || null,
      state: String((updated as any).state ?? "").trim() || null,
      country: String((updated as any).country ?? "").trim() || null,
      timezone: String((updated as any).timezone ?? "").trim() || null,
      funnel_stage: String((updated as any).funnel_stage ?? safeFunnelStage ?? "").trim() || null,
      experimental_class_status: String((updated as any).experimental_class_status ?? safeExpStatus ?? "").trim() || null,
      enrollment_number: String((updated as any).enrollment_number ?? "").trim() || null,
      internal_notes: String((updated as any).internal_notes ?? safeInternalNotes ?? "").trim() || null,
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

  const authUserIdRaw = String((lead as { auth_user_id?: string | null }).auth_user_id ?? "").trim();
  let authUserId = authUserIdRaw;
  {
    const assignedEmail = String((lead as { assigned_user_email?: string | null }).assigned_user_email ?? "").trim().toLowerCase();
    if (assignedEmail === "atendimento.usa.music@gmail.com") authUserId = "";
  }
  const { data: conversations, error: conversationsError } = await admin
    .from("atendimento_conversations")
    .select("id")
    .eq("lead_id", leadId);

  if (conversationsError) {
    return Response.json({ ok: false, error: conversationsError.message }, { status: 500 });
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

  const deleteOptionalTables = async () => {
    try {
      const up = await admin.from("atendimento_file_uploads").delete().eq("lead_id", leadId);
      if (up.error && !isRelationMissingError(up.error)) {
        return up.error;
      }
    } catch (e) {
      if (!isRelationMissingError(e)) return e;
    }
    return null;
  };

  const [messagesResult, eventsResult, capturedFieldsResult, optionalDeleteErr] = await Promise.all([
    deleteMessagesPromise,
    admin.from("atendimento_history_events").delete().eq("lead_id", leadId),
    admin.from("atendimento_captured_fields").delete().eq("lead_id", leadId),
    deleteOptionalTables(),
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

  if (optionalDeleteErr && typeof optionalDeleteErr === "object" && (optionalDeleteErr as any)?.message) {
    return Response.json({ ok: false, error: (optionalDeleteErr as any).message }, { status: 500 });
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

  if (authUserId) {
    try {
      const profileDelete = await admin.from("profiles").delete().eq("user_id", authUserId);
      if (profileDelete.error && !isRelationMissingError(profileDelete.error)) {
        return Response.json({ ok: false, error: profileDelete.error.message }, { status: 500 });
      }
    } catch (e) {
      if (!isRelationMissingError(e)) {
        return Response.json({
          ok: false,
          error: e instanceof Error ? e.message : String(e ?? "erro ao limpar perfil"),
        }, { status: 500 });
      }
    }

    try {
      const { error: deleteAuthUserError } = await admin.auth.admin.deleteUser(authUserId);
      if (deleteAuthUserError) {
        return Response.json({ ok: false, error: deleteAuthUserError.message }, { status: 500 });
      }
    } catch (e) {
      return Response.json({
        ok: false,
        error: e instanceof Error ? e.message : String(e ?? "erro ao remover credenciais do aluno"),
      }, { status: 500 });
    }
  }

  return Response.json({ ok: true });
}
