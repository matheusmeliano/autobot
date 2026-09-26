import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { isZapiInternalBlocklistedPhone } from "@/lib/atendimento/constants";
import {
  loadHiddenWhatsAppPhoneBlocklist,
  phoneIsInHiddenBrazilianBlocklist,
} from "@/lib/painelHiddenPhones";

export async function GET() {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const admin = createSupabaseAdminClient();

    const { data: leads, error } = await admin
      .from("atendimento_leads")
      .select(
        "id, status, funnel_stage, unread_count, phone, last_interaction_at, created_at, updated_at, recurring_class_status, experimental_class_booking_id, contract_signed_at, contract_status",
      )
      .eq("assigned_user_email", "atendimento.usa.music@gmail.com");

    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }

    const hiddenBlocklist = await loadHiddenWhatsAppPhoneBlocklist({ supabaseAdmin: admin });

    const rows = (leads ?? [])
      .filter((row: any) => !phoneIsInHiddenBrazilianBlocklist(String(row?.phone ?? ""), hiddenBlocklist))
      .filter((row: any) => {
        if (isZapiInternalBlocklistedPhone(String(row?.phone ?? ""))) return false;
        return true;
      }) as any[];

    const leadIds = rows.map((row: any) => String(row?.id ?? "")).filter(Boolean);
    const futureBookingByLeadId = new Map<string, any>();
    const latestBookingByLeadId = new Map<string, any>();
    const mainBookingByLeadId = new Map<string, any>();
    const draftDateByLeadId = new Map<string, any>();
    const draftTimeByLeadId = new Map<string, any>();
    const cancelledByHistoryLeadIds = new Set<string>();

    if (leadIds.length > 0) {
      const parseStartMs = (v: any) => {
        const s = String(v ?? "").trim();
        if (!s) return 0;
        const t = new Date(s).getTime();
        return Number.isFinite(t) && t > 0 ? t : 0;
      };
      const nowMs = Date.now();

      const bookingSelect =
        "id, lead_id, status, professor_start_at, lead_start_at, professor_date, lead_date, created_at, updated_at";
      let bookingData: any[] | null = null;
      try {
        const bk = await admin
          .from("atendimento_experimental_class_bookings")
          .select(bookingSelect)
          .in("lead_id", leadIds);
        if (!bk.error) bookingData = bk.data as any[];
      } catch {
        bookingData = null;
      }

      for (const bk of bookingData ?? []) {
        const leadId = String((bk as any)?.lead_id ?? "").trim();
        if (!leadId) continue;
        const status = String((bk as any)?.status ?? "").trim().toLowerCase();
        const startMs = parseStartMs((bk as any)?.professor_start_at ?? (bk as any)?.lead_start_at);
        if (!mainBookingByLeadId.has(leadId)) {
          mainBookingByLeadId.set(leadId, bk);
        }
        if (status !== "cancelled") {
          if (startMs >= nowMs) {
            const cur = futureBookingByLeadId.get(leadId);
            const curMs = cur ? parseStartMs(cur?.professor_start_at ?? cur?.lead_start_at) : 0;
            if (curMs <= 0 || (startMs > 0 && startMs < curMs)) {
              futureBookingByLeadId.set(leadId, bk);
            }
          }
          if (startMs > 0 && startMs < nowMs) {
            const cur = latestBookingByLeadId.get(leadId);
            const curMs = cur ? parseStartMs(cur?.professor_start_at ?? cur?.lead_start_at) : 0;
            if (startMs > curMs) latestBookingByLeadId.set(leadId, bk);
          }
        }
      }

      let historyEvents: any[] | null = null;
      try {
        const he = await admin
          .from("atendimento_history_events")
          .select("id, lead_id, event_type, created_at, details")
          .in("lead_id", leadIds)
          .in("event_type", [
            "experimental_class_date_selected",
            "experimental_class_time_selected",
            "experimental_class_scheduled",
            "experimental_class_cancelled",
          ])
          .order("created_at", { ascending: false });
        if (!he.error) historyEvents = he.data as any[];
      } catch {
        historyEvents = null;
      }

      for (const event of historyEvents ?? []) {
        const leadId = String((event as any)?.lead_id ?? "");
        if (!leadId) continue;
        const eventType = String((event as any)?.event_type ?? "").trim().toLowerCase();
        const eca = String((event as any)?.created_at ?? "").trim() || null;
        const details = ((event as any)?.details ?? {}) as Record<string, unknown>;
        if (eventType === "experimental_class_cancelled") {
          cancelledByHistoryLeadIds.add(leadId);
        }
        if (eventType === "experimental_class_date_selected") {
          if (!draftDateByLeadId.has(leadId)) {
            const pd = String(details?.professor_date ?? "").trim();
            const ld = String(details?.lead_date ?? "").trim();
            const label = String(details?.label ?? "").trim() || null;
            if (pd || ld) {
              draftDateByLeadId.set(leadId, {
                professor_date: pd,
                lead_date: ld,
                label,
                at: eca,
              });
            }
          }
        }
        if (eventType === "experimental_class_time_selected") {
          if (!draftTimeByLeadId.has(leadId)) {
            const pd = String(details?.professor_date ?? "").trim();
            const pt = String(details?.professor_time ?? "").trim();
            const ld = String(details?.lead_date ?? "").trim();
            const lt = String(details?.lead_time ?? "").trim();
            const psa = String(details?.professor_start_at ?? "").trim();
            const lsa = String(details?.lead_start_at ?? "").trim();
            if ((pd && pt) || (ld && lt) || psa || lsa) {
              draftTimeByLeadId.set(leadId, {
                professor_date: pd,
                professor_time: pt,
                lead_date: ld,
                lead_time: lt,
                professor_start_at: psa,
                lead_start_at: lsa,
                at: eca,
              });
            }
          }
        }
      }
    }

    const hasAnyExperimentalBooking = (row: any) => {
      const id = String(row?.id ?? "");
      const st = String(row?.status ?? "").trim().toLowerCase();
      const fs = String(row?.funnel_stage ?? "").trim().toLowerCase();
      const cleanDraftDate = cancelledByHistoryLeadIds.has(id) ? null : draftDateByLeadId.get(id) ?? null;
      const cleanDraftTime = cancelledByHistoryLeadIds.has(id) ? null : draftTimeByLeadId.get(id) ?? null;
      return Boolean(
        st === "aula_experimental_agendada" ||
          fs === "aula_experimental_agendada" ||
          (row.experimental_class_booking_id && mainBookingByLeadId.has(id)) ||
          futureBookingByLeadId.has(id) ||
          latestBookingByLeadId.has(id) ||
          mainBookingByLeadId.has(id) ||
          (cleanDraftDate && (cleanDraftDate.professor_date || cleanDraftDate.lead_date)) ||
          (cleanDraftTime &&
            ((cleanDraftTime.professor_date && cleanDraftTime.professor_time) ||
              (cleanDraftTime.lead_date && cleanDraftTime.lead_time) ||
              cleanDraftTime.professor_start_at ||
              cleanDraftTime.lead_start_at)),
      );
    };

    const isAluno = (row: any) => {
      const st = String(row.status ?? "");
      const fs = String(row.funnel_stage ?? "");
      const rcs = String(row.recurring_class_status ?? "");
      if (
        [
          "matriculado",
          "aluno_recorrente_cadastrado",
          "contrato_assinado",
          "contrato_aguardando_aceite",
          "contrato_coletando_dados",
          "cadastro_recorrente_pendente_plataforma",
        ].includes(st)
      ) {
        return true;
      }
      if (
        [
          "matricula_confirmada",
          "contrato_assinado",
          "contrato_aguardando_aceite",
          "matricula_concluida",
        ].includes(fs)
      ) {
        return true;
      }
      if (rcs === "confirmado") return true;
      return false;
    };

    const summary = {
      totalLeads: rows.length,
      novosLeads: rows.filter((row) => row.status === "novo_lead").length,
      emAtendimento: rows.filter((row) => row.status === "em_atendimento").length,
      aulasExperimentaisAgendadas: rows.filter(hasAnyExperimentalBooking).length,
      matriculasPendentes: rows.filter((row) => row.status === "matricula_pendente").length,
      matriculados: rows.filter(isAluno).length,
      conversasNaoLidas: rows.reduce((total, row) => total + Number(row.unread_count ?? 0), 0),
    };

    return Response.json({ ok: true, summary });
  } catch (error) {
    return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
