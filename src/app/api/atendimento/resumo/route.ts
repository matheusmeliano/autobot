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
        "status, funnel_stage, unread_count, phone, last_interaction_at, created_at, updated_at, recurring_class_status, future_experimental_class_booking, latest_experimental_class_booking, experimental_class_booking, contract_signed_at, contract_status",
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

    const hasAnyExperimentalBooking = (row: any) => {
      return Boolean(
        row.future_experimental_class_booking ||
          row.latest_experimental_class_booking ||
          row.experimental_class_booking,
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
      aulasExperimentaisAgendadas: rows.filter(
        (row) => row.funnel_stage === "aula_experimental_agendada" || hasAnyExperimentalBooking(row),
      ).length,
      matriculasPendentes: rows.filter((row) => row.status === "matricula_pendente").length,
      matriculados: rows.filter(isAluno).length,
      conversasNaoLidas: rows.reduce((total, row) => total + Number(row.unread_count ?? 0), 0),
    };

    return Response.json({ ok: true, summary });
  } catch (error) {
    return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
