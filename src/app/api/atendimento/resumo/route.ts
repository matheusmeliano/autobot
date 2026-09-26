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
        if (status !== "cancelled") {
          if (!mainBookingByLeadId.has(leadId)) {
            mainBookingByLeadId.set(leadId, bk);
          }
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
    }

    const hasAnyExperimentalBooking = (row: any) => {
      const id = String(row?.id ?? "");
      return Boolean(
        row.funnel_stage === "aula_experimental_agendada" ||
          (row.experimental_class_booking_id && mainBookingByLeadId.has(id)) ||
          futureBookingByLeadId.has(id) ||
          latestBookingByLeadId.has(id) ||
          mainBookingByLeadId.has(id),
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
