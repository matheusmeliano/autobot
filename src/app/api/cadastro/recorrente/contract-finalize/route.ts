import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendHistoryEvent, findLeadByPhone, formalizeAndPersistContract, syncConversationPreview } from "@/lib/atendimento/server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const telefone = String(body?.telefone ?? "").replace(/\D/g, "").trim();
  const leadId = String(body?.leadId ?? "").trim();
  try {
    const admin = createSupabaseAdminClient();
    let lead: any = null;
    if (leadId && leadId.length > 0) {
      const { data } = await admin
        .from("atendimento_leads")
        .select("*")
        .eq("id", leadId)
        .maybeSingle();
      lead = data;
    }
    if (!lead?.id && telefone.length >= 10) {
      lead = await findLeadByPhone({ phone: telefone });
    }
    if (!lead?.id) {
      return Response.json({ ok: false, error: "Cadastro não encontrado." }, { status: 404 });
    }

    try {
      await admin
        .from("atendimento_leads")
        .update({ contract_status: "aguardando_aceite" })
        .eq("id", String(lead.id));
    } catch {}

    const result: any = await (formalizeAndPersistContract as any)({
      admin,
      leadId: String(lead.id),
    });

    try {
      const { data: conversations } = await admin
        .from("atendimento_conversations")
        .select("id, lead_id")
        .eq("lead_id", String(lead.id))
        .order("created_at", { ascending: false })
        .limit(1);
      const conversation = conversations?.[0] ?? null;
      if (conversation?.id) {
        try {
          await (syncConversationPreview as any)({
            conversationId: String(conversation.id),
          });
        } catch {}
      }
    } catch {}

    return Response.json({
      ok: true,
      contract_pdf_url: String(result?.contract_pdf_url ?? result?.contractPdfUrl ?? null),
      contract_signed_at: String(result?.contract_signed_at ?? result?.signedAtIso ?? new Date().toISOString()),
      leadId: String(lead.id),
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message ?? "Falha ao gerar o contrato.") }, { status: 500 });
  }
}
