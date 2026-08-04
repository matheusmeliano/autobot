import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
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
      .select("status, funnel_stage, unread_count, phone")
      .eq("assigned_user_email", "atendimento.usa.music@gmail.com");

    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }

    const hiddenBlocklist = await loadHiddenWhatsAppPhoneBlocklist({ supabaseAdmin: admin });

    const rows = (leads ?? [])
      .filter((row: any) => !phoneIsInHiddenBrazilianBlocklist(String(row?.phone ?? ""), hiddenBlocklist)) as any[];
    const summary = {
      totalLeads: rows.length,
      novosLeads: rows.filter((row) => row.status === "novo_lead").length,
      emAtendimento: rows.filter((row) => row.status === "em_atendimento").length,
      aulasExperimentaisAgendadas: rows.filter((row) => row.funnel_stage === "aula_experimental_agendada").length,
      matriculasPendentes: rows.filter((row) => row.status === "matricula_pendente").length,
      matriculados: rows.filter((row) => row.status === "matriculado").length,
      conversasNaoLidas: rows.reduce((total, row) => total + Number(row.unread_count ?? 0), 0),
    };

    return Response.json({ ok: true, summary });
  } catch (error) {
    return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
