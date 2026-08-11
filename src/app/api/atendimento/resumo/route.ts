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

    let cutoffInstanceTimeMs = 0;
    {
      const userId = String(auth.user?.id ?? "").trim();
      if (userId) {
        try {
          const { data: inst } = await admin
            .from("whatsapp_instances")
            .select("instance_id, created_at, updated_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (inst) {
            const cAt = new Date(String((inst as any)?.created_at ?? 0)).getTime();
            const uAt = new Date(String((inst as any)?.updated_at ?? (inst as any)?.created_at ?? 0)).getTime();
            cutoffInstanceTimeMs = Math.max(cAt, uAt);
          }
        } catch (_cutoffErr) {
          cutoffInstanceTimeMs = 0;
        }
      }
    }

    const { data: leads, error } = await admin
      .from("atendimento_leads")
      .select("status, funnel_stage, unread_count, phone, last_interaction_at, created_at, updated_at")
      .eq("assigned_user_email", "atendimento.usa.music@gmail.com");

    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }

    const hiddenBlocklist = await loadHiddenWhatsAppPhoneBlocklist({ supabaseAdmin: admin });

    const rows = (leads ?? [])
      .filter((row: any) => !phoneIsInHiddenBrazilianBlocklist(String(row?.phone ?? ""), hiddenBlocklist))
      .filter((row: any) => {
        if (cutoffInstanceTimeMs <= 0) return true;
        const candidates = [
          row?.last_interaction_at,
          row?.updated_at,
          row?.created_at,
        ];
        let sortTime = 0;
        for (const c of candidates) {
          const t = new Date(String(c ?? "")).getTime();
          if (Number.isFinite(t) && t > 0) {
            sortTime = t;
            break;
          }
        }
        return sortTime >= cutoffInstanceTimeMs;
      }) as any[];
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
