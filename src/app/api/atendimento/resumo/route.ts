import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE, isZapiInternalBlocklistedPhone } from "@/lib/atendimento/constants";
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

export async function GET() {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const admin = createSupabaseAdminClient();

    // MESMO pipeline de /api/atendimento/leads/route.ts para garantir 100% igualdade
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
      .filter((row: any) => !phoneIsInHiddenBrazilianBlocklist(String(row?.phone ?? ""), hiddenBlocklist))
      .filter((row: any) => {
        if (isZapiInternalBlocklistedPhone(String(row?.phone ?? ""))) return false;
        return true;
      }) as any[];

    const rows = leadRows;
    const leadIds = rows.map((row: any) => String(row.id ?? "")).filter(Boolean);
    const bookingsByLeadId = new Map<string, any>();
    const bookingsByLeadIdIncludingCancelled = new Map<string, any>();
    const bookingsById = new Map<string, any>();
    const latestBookingByLeadId = new Map<string, any>();
    const futureExperimentalBookingByLeadId = new Map<string, any>();
    const cancelledLeadBookingIds = new Set<string>();
    const cancelledByHistoryLeadIds = new Set<string>();
    const cancelledAtByLeadId = new Map<string, string>();
    const cancelledProfessorSnapshotByLeadId = new Map<
      string,
      {
        name: string; phone: string; leadDate: string; leadTime: string;
        professorDate: string; professorTime: string; leadStartAt: string;
        professorStartAt: string; leadTimezone: string; professorTimezone: string;
        lessonLink: string;
      }
    >();
    const draftDateByLeadId = new Map<string, any>();
    const draftTimeByLeadId = new Map<string, any>();
    const contractMetaByLeadId = new Map<string, {
      contract_signed_at: string | null;
      contract_status: string | null;
      contract_pdf_url: string | null;
      funnel_stage: string | null;
      status: string | null;
    }>();
    const paymentMetaByLeadId = new Map<string, {
      payment_status: string | null;
      payment_confirmed_at: string | null;
      payment_rejected_at: string | null;
      funnel_stage: string | null;
      status: string | null;
    }>();

    const parseStartAtMs = (value: unknown): number => {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      const t = new Date(raw).getTime();
      return Number.isFinite(t) && t > 0 ? t : 0;
    };
    const nowMs = Date.now();

    // Bookings de tabela (igual /leads)
    if (leadIds.length > 0) {
      let bookings: any[] | null = null;
      let bookingsError: any = null;

      const bookingsSelectWithLessonLink =
        "id, lead_id, status, lesson_link, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, attendance_status, student_start_notification_sent_at, attendant_start_notification_sent_at, post_attendance_message_sent_at, created_at, updated_at, assigned_professor_name, assigned_professor_phone";
      const bookingsSelectWithoutLessonLink =
        "id, lead_id, status, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, attendance_status, student_start_notification_sent_at, attendant_start_notification_sent_at, post_attendance_message_sent_at, created_at, updated_at, assigned_professor_name, assigned_professor_phone";

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
        const candidate = {
          ...(booking as any),
          lesson_link: String((booking as any)?.lesson_link ?? "").trim() || null,
          student_start_notification_sent_at: String((booking as any)?.student_start_notification_sent_at ?? "").trim() || null,
          attendant_start_notification_sent_at: String((booking as any)?.attendant_start_notification_sent_at ?? "").trim() || null,
          post_attendance_message_sent_at: String((booking as any)?.post_attendance_message_sent_at ?? "").trim() || null,
          attendance_status: String((booking as any)?.attendance_status ?? "").trim() || null,
          attendance_checked_at: null,
          professor_timezone: String((booking as any)?.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
          source: "table",
        };
        const bid = String(candidate.id ?? "").trim();
        if (bid && !bookingsById.has(bid)) bookingsById.set(bid, candidate);
        const existingIncluding = bookingsByLeadIdIncludingCancelled.get(leadId);
        if (!existingIncluding) {
          bookingsByLeadIdIncludingCancelled.set(leadId, candidate);
        } else {
          const curStr = String(
            (existingIncluding as any)?.updated_at || (existingIncluding as any)?.created_at || "",
          );
          const newStr = String((booking as any).updated_at || (booking as any).created_at || "");
          if (newStr > curStr) {
            bookingsByLeadIdIncludingCancelled.set(leadId, candidate);
          }
        }
        if (status === "cancelled") {
          if (!cancelledLeadBookingIds.has(leadId)) cancelledLeadBookingIds.add(leadId);
          const existingCancelled = cancelledAtByLeadId.get(leadId);
          if (!existingCancelled) {
            cancelledAtByLeadId.set(
              leadId,
              String((booking as any).updated_at || (booking as any).created_at || ""),
            );
          }
          continue;
        }
        const existing = bookingsByLeadId.get(leadId);
        if (!existing) {
          bookingsByLeadId.set(leadId, candidate);
        } else {
          const curStr = String(existing?.updated_at || existing?.created_at || "");
          const newStr = String((booking as any).updated_at || (booking as any).created_at || "");
          if (newStr > curStr) bookingsByLeadId.set(leadId, candidate);
        }
        const startMs = parseStartAtMs(candidate.professor_start_at || candidate.lead_start_at);
        const currentLatest = latestBookingByLeadId.get(leadId);
        const currentLatestMs = currentLatest
          ? parseStartAtMs(currentLatest.professor_start_at || currentLatest.lead_start_at)
          : 0;
        if (startMs > 0 && startMs < nowMs && startMs > currentLatestMs) {
          latestBookingByLeadId.set(leadId, candidate);
        }
        if (startMs >= nowMs) {
          const curFuture = futureExperimentalBookingByLeadId.get(leadId);
          const curFutureMs = curFuture
            ? parseStartAtMs(curFuture.professor_start_at || curFuture.lead_start_at)
            : 0;
          if (curFutureMs <= 0 || (startMs > 0 && startMs < curFutureMs)) {
            futureExperimentalBookingByLeadId.set(leadId, candidate);
          }
        }
      }

      // History events (igual /leads)
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
          "contrato_assinado",
          "recurring_payment_confirmed",
          "recurring_payment_rejected",
          "recurring_payment_intent_registered",
          "attendant_clicked_payment_sim",
          "attendant_clicked_payment_nao",
        ])
        .order("created_at", { ascending: false });
      if (!historyError && (historyEvents ?? []).length > 0) {
        for (const event of historyEvents ?? []) {
          const leadId = String((event as any)?.lead_id ?? "");
          if (!leadId) continue;
          const eventType = String((event as any)?.event_type ?? "").trim().toLowerCase();
          const eca = String((event as any)?.created_at ?? "").trim() || null;
          const details = ((event as any)?.details ?? {}) as Record<string, unknown>;
          if (eventType === "experimental_class_cancelled") {
            cancelledByHistoryLeadIds.add(leadId);
            if (!cancelledAtByLeadId.has(leadId)) cancelledAtByLeadId.set(leadId, String(eca ?? "").trim());
            if (!cancelledProfessorSnapshotByLeadId.has(leadId)) {
              const n = String(details?.professor_name_before ?? "").trim();
              const p = String(details?.professor_phone_before ?? "").trim();
              const ld = String(details?.lead_date_before ?? "").trim();
              const lt = String(details?.lead_time_before ?? "").trim();
              const pd = String(details?.professor_date_before ?? "").trim();
              const pt = String(details?.professor_time_before ?? "").trim();
              const lsa = String(details?.lead_start_at_before ?? details?.lead_start_at ?? "").trim();
              const psa = String(
                details?.professor_start_at_before ?? details?.professor_start_at ?? "",
              ).trim();
              const ltz = String(details?.lead_timezone_before ?? details?.lead_timezone ?? "").trim();
              const ptz = String(
                details?.professor_timezone_before ?? details?.teacher_timezone ?? details?.professor_timezone ?? "",
              ).trim();
              const llink = String(details?.lesson_link_before ?? details?.lesson_link ?? "").trim();
              if (n || p || ld || lt || pd || pt || lsa || psa || ltz || ptz || llink) {
                cancelledProfessorSnapshotByLeadId.set(leadId, {
                  name: n, phone: p, leadDate: ld, leadTime: lt,
                  professorDate: pd, professorTime: pt,
                  leadStartAt: lsa, professorStartAt: psa,
                  leadTimezone: ltz, professorTimezone: ptz, lessonLink: llink,
                });
              }
            }
          }
          if (eventType === "experimental_class_date_selected" && !draftDateByLeadId.has(leadId)) {
            const pd = String(details?.professor_date ?? "").trim();
            const ld = String(details?.lead_date ?? "").trim();
            const label = String(details?.label ?? "").trim() || null;
            if (pd || ld) draftDateByLeadId.set(leadId, { professor_date: pd, lead_date: ld, label, at: eca });
          }
          if (eventType === "experimental_class_time_selected" && !draftTimeByLeadId.has(leadId)) {
            const pd = String(details?.professor_date ?? "").trim();
            const pt = String(details?.professor_time ?? "").trim();
            const ld = String(details?.lead_date ?? "").trim();
            const lt = String(details?.lead_time ?? "").trim();
            const psa = String(details?.professor_start_at ?? "").trim();
            const lsa = String(details?.lead_start_at ?? "").trim();
            if ((pd && pt) || (ld && lt) || psa || lsa) {
              draftTimeByLeadId.set(leadId, {
                professor_date: pd, professor_time: pt, lead_date: ld, lead_time: lt,
                professor_start_at: psa, lead_start_at: lsa, at: eca,
              });
            }
          }
          if (eventType === "contrato_assinado") {
            const existingContract = contractMetaByLeadId.get(leadId);
            const CONTRACT_PRIORITY: Record<string, number> = {
              coletando_dados: 2, aguardando_aceite: 6, assinado: 10,
              contrato_coletando_dados: 2, contrato_aguardando_aceite: 6, contrato_assinado: 10,
            };
            const rank = (s: any) => CONTRACT_PRIORITY[String(s ?? "").toLowerCase()] ?? 0;
            const cs = String(details?.contract_status ?? details?.status ?? "").trim();
            const signedAt =
              (typeof details?.contract_signed_at === "string" && String(details.contract_signed_at).trim()) ||
              (typeof details?.value === "string" && String(details.value).trim()) ||
              (typeof (event as any)?.created_at === "string" && String((event as any).created_at).trim()) ||
              null;
            const pdf = String(details?.contract_pdf_url ?? "").trim() || null;
            const fn_st = String(details?.funnel_stage ?? details?.status ?? "").trim() || null;
            const st_st = String(details?.status ?? "").trim() || null;
            const candidate = {
              contract_status: cs,
              contract_signed_at: signedAt,
              contract_pdf_url: pdf,
              funnel_stage: fn_st,
              status: st_st,
            };
            if (!existingContract || rank(candidate.contract_status) > rank(existingContract.contract_status) ||
              (!existingContract.contract_status && candidate.contract_status)) {
              contractMetaByLeadId.set(leadId, candidate);
            }
          }
          const PAYMENT_RANK: Record<string, number> = {
            pendente_confirmacao: 2, nao_realizado: 5, confirmado: 10,
            pagamento_pendente_confirmacao: 2, pagamento_nao_realizado: 5, confirmar: 10,
          };
          if (eventType === "recurring_payment_confirmed" || eventType === "attendant_clicked_payment_sim" ||
              eventType === "recurring_payment_rejected" || eventType === "recurring_payment_intent_registered" ||
              eventType === "attendant_clicked_payment_nao") {
            const existingPayment = paymentMetaByLeadId.get(leadId);
            const rank = (s: any) => PAYMENT_RANK[String(s ?? "").toLowerCase()] ?? 0;
            let ps: string | null = null;
            let pca: string | null = null;
            let pra: string | null = null;
            if (eventType === "recurring_payment_confirmed") { ps = "confirmado"; pca = String(details?.created_at ?? eca) || null; }
            if (eventType === "recurring_payment_rejected") { ps = "nao_realizado"; pra = String(details?.created_at ?? eca) || null; }
            if (eventType === "attendant_clicked_payment_sim") ps = "confirmado";
            if (eventType === "attendant_clicked_payment_nao") ps = "nao_realizado";
            if (eventType === "recurring_payment_intent_registered") ps = "pendente_confirmacao";
            const candidate = {
              payment_status: ps, payment_confirmed_at: pca, payment_rejected_at: pra,
              funnel_stage: String(details?.funnel_stage ?? "").trim() || null,
              status: String(details?.status ?? "").trim() || null,
            };
            if (!existingPayment || rank(candidate.payment_status) > rank(existingPayment.payment_status) ||
              (!existingPayment.payment_status && candidate.payment_status)) {
              paymentMetaByLeadId.set(leadId, candidate);
            }
          }
        }
      } else if (historyError) {
        return Response.json({ ok: false, error: historyError.message }, { status: 500 });
      }
    }

    // Build composite lead (igual /leads/route.ts: monta latest_experimental_class_booking / future / experimental_class_booking)
    const processedLeads = rows.map((row) => {
      const leadId = String(row.id ?? "");
      const preferredBookingId = String((row as any)?.experimental_class_booking_id ?? "").trim();
      const preferredBooking =
        (preferredBookingId ? bookingsById.get(preferredBookingId) ?? null : null) as any;
      const existingBookingRaw =
        preferredBooking ?? bookingsByLeadId.get(leadId) ?? bookingsByLeadIdIncludingCancelled.get(leadId) ?? null;
      const isCancelledLead = cancelledLeadBookingIds.has(leadId) || cancelledByHistoryLeadIds.has(leadId);
      const cancelledAt = cancelledAtByLeadId.get(leadId) ?? null;
      const cancelledProfSnap = cancelledProfessorSnapshotByLeadId.get(leadId) ?? null;
      const snapProfName = String(cancelledProfSnap?.name ?? "").trim();
      const snapProfPhone = String(cancelledProfSnap?.phone ?? "").trim();
      const snapLeadDate = String(cancelledProfSnap?.leadDate ?? "").trim();
      const snapLeadTime = String(cancelledProfSnap?.leadTime ?? "").trim();
      const snapProfessorDate = String(cancelledProfSnap?.professorDate ?? "").trim();
      const snapProfessorTime = String(cancelledProfSnap?.professorTime ?? "").trim();
      const snapLeadStartAt = String(cancelledProfSnap?.leadStartAt ?? "").trim();
      const snapProfessorStartAt = String(cancelledProfSnap?.professorStartAt ?? "").trim();
      const snapLeadTimezone = String(cancelledProfSnap?.leadTimezone ?? "").trim();
      const snapProfessorTimezone = String(cancelledProfSnap?.professorTimezone ?? "").trim();
      const snapLessonLink = String(cancelledProfSnap?.lessonLink ?? "").trim();

      const existingBooking = existingBookingRaw ?? (isCancelledLead ? (
        {
          id: "", status: "cancelled", lesson_link: snapLessonLink || null,
          student_start_notification_sent_at: null, attendant_start_notification_sent_at: null,
          attendance_status: null, attendance_checked_at: null,
          professor_timezone: snapProfessorTimezone || ATENDIMENTO_PROFESSOR_TIME_ZONE,
          lead_timezone: snapLeadTimezone || String((row as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
          professor_date: snapProfessorDate || "", professor_time: snapProfessorTime || "",
          professor_start_at: snapProfessorStartAt || "",
          lead_date: snapLeadDate || "", lead_time: snapLeadTime || "",
          lead_start_at: snapLeadStartAt || "",
          assigned_professor_name: String((row as any)?.experimental_class_professor_name ?? "").trim() || snapProfName || null,
          assigned_professor_phone: String((row as any)?.experimental_class_professor_phone ?? "").trim() || snapProfPhone || null,
          conversation_id: String((row as any)?.conversation_id ?? ""),
          created_at: cancelledAt || String(row.updated_at ?? row.created_at ?? ""),
          updated_at: cancelledAt || String(row.updated_at ?? row.created_at ?? ""),
          source: "cancelled_history",
        } as any
      ) : null);
      const cleanDraftDate = isCancelledLead ? null : draftDateByLeadId.get(leadId) ?? null;
      const cleanDraftTime = isCancelledLead ? null : draftTimeByLeadId.get(leadId) ?? null;

      const bookingWithFallback: any = existingBooking ?? (() => {
        if (cleanDraftTime && ((cleanDraftTime.professor_date && cleanDraftTime.professor_time) ||
            (cleanDraftTime.lead_date && cleanDraftTime.lead_time) || cleanDraftTime.professor_start_at || cleanDraftTime.lead_start_at)) {
          return {
            id: `draft-${leadId}-time`,
            status: "draft",
            lesson_link: null,
            student_start_notification_sent_at: null,
            attendant_start_notification_sent_at: null,
            attendance_status: null,
            attendance_checked_at: null,
            professor_timezone: snapProfessorTimezone || ATENDIMENTO_PROFESSOR_TIME_ZONE,
            lead_timezone: snapLeadTimezone || String((row as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
            professor_date: cleanDraftTime.professor_date || cleanDraftDate?.professor_date || "",
            professor_time: cleanDraftTime.professor_time || "",
            professor_start_at: cleanDraftTime.professor_start_at || "",
            lead_date: cleanDraftTime.lead_date || cleanDraftDate?.lead_date || "",
            lead_time: cleanDraftTime.lead_time || "",
            lead_start_at: cleanDraftTime.lead_start_at || "",
            assigned_professor_name: String((row as any)?.experimental_class_professor_name ?? "").trim() || snapProfName || null,
            assigned_professor_phone: String((row as any)?.experimental_class_professor_phone ?? "").trim() || snapProfPhone || null,
            created_at: cleanDraftTime.at || String(row.updated_at ?? row.created_at ?? ""),
            updated_at: cleanDraftTime.at || String(row.updated_at ?? row.created_at ?? ""),
            source: "draft_time",
          };
        }
        if (cleanDraftDate && (cleanDraftDate.professor_date || cleanDraftDate.lead_date)) {
          return {
            id: `draft-${leadId}-date`,
            status: "draft_date_only",
            lesson_link: null,
            student_start_notification_sent_at: null,
            attendant_start_notification_sent_at: null,
            attendance_status: null,
            attendance_checked_at: null,
            professor_timezone: snapProfessorTimezone || ATENDIMENTO_PROFESSOR_TIME_ZONE,
            lead_timezone: snapLeadTimezone || String((row as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
            professor_date: cleanDraftDate.professor_date || "",
            professor_time: "",
            professor_start_at: "",
            lead_date: cleanDraftDate.lead_date || "",
            lead_time: "",
            lead_start_at: "",
            assigned_professor_name: String((row as any)?.experimental_class_professor_name ?? "").trim() || snapProfName || null,
            assigned_professor_phone: String((row as any)?.experimental_class_professor_phone ?? "").trim() || snapProfPhone || null,
            created_at: cleanDraftDate.at || String(row.updated_at ?? row.created_at ?? ""),
            updated_at: cleanDraftDate.at || String(row.updated_at ?? row.created_at ?? ""),
            source: "draft_date",
          };
        }
        return null;
      })();

      // Contract fallback (contract_status / contract_signed_at / contract_pdf_url)
      const CONTRACT_RANK: Record<string, number> = {
        coletando_dados: 5, aguardando_aceite: 10, assinado: 20,
        contrato_coletando_dados: 5, contrato_aguardando_aceite: 10, contrato_assinado: 20,
      };
      const contractRank = (s?: string) => CONTRACT_RANK[String(s ?? "").toLowerCase()] ?? 0;
      const rowContractStatus = String((row as any)?.contract_status ?? "").trim().toLowerCase();
      const rowContractSignedAt = String((row as any)?.contract_signed_at ?? "").trim() || null;
      const rowContractPdf = String((row as any)?.contract_pdf_url ?? "").trim() || null;
      const rowContractFunnel = String((row as any)?.funnel_stage ?? "").trim().toLowerCase();
      const rowContractLeadStatus = String((row as any)?.status ?? "").trim().toLowerCase();
      const histContract = contractMetaByLeadId.get(leadId) ?? null;
      const rowContractRank =
        contractRank(rowContractStatus) + contractRank(rowContractFunnel) + contractRank(rowContractLeadStatus);
      const histContractRank = histContract?.contract_status
        ? contractRank(String(histContract.contract_status)) +
          contractRank(String(histContract.funnel_stage ?? "")) + contractRank(String(histContract.status ?? ""))
        : 0;
      const useContractHistoryFallback = !!histContract && (rowContractRank < histContractRank || (!rowContractStatus && histContract.contract_status));
      const finalContractStatus = useContractHistoryFallback
        ? histContract!.contract_status
        : rowContractStatus || null;
      const finalContractSignedAt =
        rowContractSignedAt || (useContractHistoryFallback ? histContract!.contract_signed_at : null);
      const finalContractPdf =
        rowContractPdf || (useContractHistoryFallback ? histContract!.contract_pdf_url : null);

      // Payment fallback
      const PAYMENT_RANK: Record<string, number> = {
        contrato_coletando_dados: 4, contrato_aguardando_aceite: 6, contrato_assinado: 8,
        pagamento_pendente_confirmacao: 20, pagamento_nao_realizado: 30,
        pendente_confirmacao: 20, nao_realizado: 30, confirmado: 40, matriculado: 50,
        coletando_dados: 4, aguardando_aceite: 6, assinado: 8,
      };
      const payRank = (s?: string) => PAYMENT_RANK[String(s ?? "").toLowerCase()] ?? 0;
      const rowPaymentStatus = String((row as any)?.payment_status ?? "").trim().toLowerCase();
      const rowFunnelStage = String((row as any)?.funnel_stage ?? "").trim().toLowerCase();
      const rowLeadStatus = String((row as any)?.status ?? "").trim().toLowerCase();
      const rowConfirmedAt = String((row as any)?.payment_confirmed_at ?? "").trim() || null;
      const rowRejectedAt = String((row as any)?.payment_rejected_at ?? "").trim() || null;
      const histMeta = paymentMetaByLeadId.get(leadId) ?? null;
      const rowPayRank =
        payRank(rowPaymentStatus) + payRank(rowFunnelStage) + payRank(rowLeadStatus);
      const histPayRank = histMeta?.payment_status
        ? payRank(String(histMeta.payment_status)) +
          payRank(String(histMeta.funnel_stage ?? "")) + payRank(String(histMeta.status ?? ""))
        : 0;
      const usePayHistoryFallback = !!(histMeta && (rowPayRank < histPayRank || (!rowPaymentStatus && histMeta.payment_status)));
      const finalPaymentStatus = usePayHistoryFallback ? histMeta!.payment_status : rowPaymentStatus || null;
      const finalFunnelStage = usePayHistoryFallback && histMeta!.funnel_stage ? histMeta!.funnel_stage : rowFunnelStage || null;
      const finalLeadStatus = usePayHistoryFallback && histMeta!.status ? histMeta!.status : rowLeadStatus || null;
      const finalConfirmedAt = rowConfirmedAt || (usePayHistoryFallback ? histMeta!.payment_confirmed_at : null);
      const finalRejectedAt = rowRejectedAt || (usePayHistoryFallback ? histMeta!.payment_rejected_at : null);

      const finalFunnel = finalFunnelStage || (useContractHistoryFallback && histContract?.funnel_stage) || null;
      const finalStatus = finalLeadStatus || (useContractHistoryFallback && histContract?.status) || null;

      return {
        ...row,
        status: finalStatus || String((row as any)?.status ?? "") || null,
        funnel_stage: finalFunnel || String((row as any)?.funnel_stage ?? "") || null,
        payment_status: finalPaymentStatus,
        contract_status: finalContractStatus || String((row as any)?.contract_status ?? "") || null,
        contract_signed_at: finalContractSignedAt,
        contract_pdf_url: finalContractPdf,
        recurring_class_status: String((row as any)?.recurring_class_status ?? "") || null,
        future_experimental_class_booking: futureExperimentalBookingByLeadId.get(leadId) ?? null,
        latest_experimental_class_booking: latestBookingByLeadId.get(leadId) ?? null,
        experimental_class_booking: bookingWithFallback,
        experimental_class_booking_id: String((row as any)?.experimental_class_booking_id ?? "") || null,
      } as any;
    });

    // Contagem MESMA regra do applyFiltersToLeads (AtendimentoClient statusMatches sid === "aula_experimental_agendada"
    const hasExp = (l: any) => {
      const st = String(l.status ?? "").trim().toLowerCase();
      const fs = String(l.funnel_stage ?? "").trim().toLowerCase();
      return !!(
        st === "aula_experimental_agendada" ||
        fs === "aula_experimental_agendada" ||
        l.future_experimental_class_booking ||
        l.latest_experimental_class_booking ||
        l.experimental_class_booking
      );
    };
    // Contagem isAluno (mesma regra applyFiltersToLeads sid === "aluno"
    const isAluno = (l: any) => {
      const st = String(l.status ?? "").trim().toLowerCase();
      const fs = String(l.funnel_stage ?? "").trim().toLowerCase();
      const rcs = String(l.recurring_class_status ?? "").trim().toLowerCase();
      return (
        st === "matriculado" || fs === "matriculado" || st === "aluno" || fs === "aluno" ||
        fs === "aluno_recorrente_cadastrado" || st === "aluno_recorrente_cadastrado" ||
        st === "cadastro_recorrente_pendente_plataforma" || fs === "cadastro_recorrente_pendente_plataforma" ||
        st === "contrato_assinado" || fs === "contrato_assinado" ||
        st === "contrato_aguardando_aceite" || fs === "contrato_aguardando_aceite" ||
        st === "contrato_coletando_dados" || fs === "contrato_coletando_dados" ||
        st === "matricula_confirmada" || fs === "matricula_confirmada" ||
        rcs === "confirmado" || rcs === "cadastro_plataforma_pendente"
      );
    };

    const summary = {
      totalLeads: processedLeads.length,
      novosLeads: processedLeads.filter((row) => String(row.status ?? "").trim().toLowerCase() === "novo_lead").length,
      emAtendimento: processedLeads.filter((row) => String(row.status ?? "").trim().toLowerCase() === "em_atendimento").length,
      aulasExperimentaisAgendadas: processedLeads.filter(hasExp).length,
      matriculasPendentes: processedLeads.filter((row) => String(row.status ?? "").trim().toLowerCase() === "matricula_pendente").length,
      matriculados: processedLeads.filter(isAluno).length,
      conversasNaoLidas: processedLeads.reduce((total, row) => total + Number(row.unread_count ?? 0), 0),
    };

    return Response.json({ ok: true, summary });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: "internal_error",
        message: String(error?.message ?? "Falha ao calcular resumo."),
      },
      { status: 500 },
    );
  }
}
