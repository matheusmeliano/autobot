import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findLeadByPhone, formalizeAndPersistContract, syncConversationPreview } from "@/lib/atendimento/server";

function toErrorMessage(raw: unknown, fallback = "Erro desconhecido."): string {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "string") {
    const s = raw.trim();
    return s || fallback;
  }
  if (raw instanceof Error) {
    const m = raw.message?.trim();
    return m || fallback;
  }
  if (typeof raw === "object") {
    const any = raw as Record<string, unknown>;
    const candidates = [any.message, any.error, any.error_message, any.msg, any.detail];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw) || fallback;
    }
  }
  return String(raw) || fallback;
}

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
    return Response.json({ ok: false, error: toErrorMessage(e, "Falha ao gerar o contrato.") }, { status: 500 });
  }
}
