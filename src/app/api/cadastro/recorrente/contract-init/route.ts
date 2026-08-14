import { CONTRACT_FIELD_ORDER, CONTRACT_OPTIONAL_FIELDS, CONTRACT_FIELD_LABELS } from "@/lib/atendimento/constants";
import type { CONTRACT_FIELD_ORDER as CFO } from "@/lib/atendimento/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findLeadByPhone } from "@/lib/atendimento/server";

type ContractFieldName = (typeof CFO)[number];

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

    function getRawFieldValue(name: ContractFieldName): string | null {
      if (name === "full_name") return String(lead.full_name ?? lead.nome_completo ?? lead.nome ?? "").trim() || null;
      if (name === "cpf") return String(lead.cpf ?? "").replace(/\D/g, "").trim() || null;
      if (name === "phone") {
        const p = String(lead.phone_digits ?? lead.telefone ?? lead.whatsapp ?? lead.phone ?? "").replace(/\D/g, "").trim();
        return p || null;
      }
      if (name === "legal_responsible_name") return String(lead.legal_responsible_name ?? "").trim() || null;
      if (name === "legal_responsible_cpf") return String(lead.legal_responsible_cpf ?? "").replace(/\D/g, "").trim() || null;
      return null;
    }

    const snapshot: Record<ContractFieldName, string | null> = {
      full_name: getRawFieldValue("full_name"),
      cpf: getRawFieldValue("cpf"),
      phone: getRawFieldValue("phone"),
      legal_responsible_name: getRawFieldValue("legal_responsible_name"),
      legal_responsible_cpf: getRawFieldValue("legal_responsible_cpf"),
    };

    const pending: ContractFieldName[] = CONTRACT_FIELD_ORDER.filter((name) => !snapshot[name]);
    const next: ContractFieldName | null = pending[0] ?? null;

    return Response.json({
      ok: true,
      leadId: String(lead.id),
      snapshot,
      allFieldOrder: CONTRACT_FIELD_ORDER as unknown as ContractFieldName[],
      optionalFields: Array.from(CONTRACT_OPTIONAL_FIELDS) as unknown as ContractFieldName[],
      fieldLabels: CONTRACT_FIELD_LABELS,
      nextField: next,
      allFields: (CONTRACT_FIELD_ORDER as unknown as readonly ContractFieldName[]).map((name) => ({
        name,
        optional: CONTRACT_OPTIONAL_FIELDS.has(name as any),
        label: CONTRACT_FIELD_LABELS[name],
        currentValue: snapshot[name],
        alreadyFilled: Boolean(snapshot[name]),
      })),
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message ?? "Falha ao carregar dados do contrato.") }, { status: 500 });
  }
}
