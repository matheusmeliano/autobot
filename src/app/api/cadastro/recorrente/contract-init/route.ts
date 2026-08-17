import { CONTRACT_FIELD_ORDER, CONTRACT_OPTIONAL_FIELDS, CONTRACT_FIELD_LABELS } from "@/lib/atendimento/constants";
import type { CONTRACT_FIELD_ORDER as CFO } from "@/lib/atendimento/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findLeadByPhone } from "@/lib/atendimento/server";

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
      return Response.json({
        ok: false,
        blocked: true,
        error:
          "Acesso bloqueado. Seu cadastro foi excluído. Para acessar novamente, inicie um novo atendimento pelo WhatsApp.",
      }, { status: 403 });
    }

    function getRawFieldValue(name: ContractFieldName): string | null {
      if (name === "full_name") {
        const v = lead.full_name;
        if (v === "") return "";
        return String(v ?? "").trim() || null;
      }
      if (name === "cpf") {
        const v = lead.cpf;
        if (v === "") return "";
        return String(v ?? "").replace(/\D/g, "").trim() || null;
      }
      if (name === "phone") {
        const v = lead.phone;
        if (v === "") return "";
        const p = String(v ?? "").replace(/\D/g, "").trim();
        return p || null;
      }
      if (name === "legal_responsible_name") {
        const v = lead.legal_responsible_name;
        if (v === "") return "";
        return String(v ?? "").trim() || null;
      }
      if (name === "legal_responsible_cpf") {
        const v = lead.legal_responsible_cpf;
        if (v === "") return "";
        return String(v ?? "").replace(/\D/g, "").trim() || null;
      }
      return null;
    }

    const snapshot: Record<ContractFieldName, string | null> = {
      full_name: getRawFieldValue("full_name"),
      cpf: getRawFieldValue("cpf"),
      phone: getRawFieldValue("phone"),
      legal_responsible_name: getRawFieldValue("legal_responsible_name"),
      legal_responsible_cpf: getRawFieldValue("legal_responsible_cpf"),
    };

    const pending: ContractFieldName[] = CONTRACT_FIELD_ORDER.filter(
      (name) => snapshot[name] === null,
    ) as unknown as ContractFieldName[];
    const next: ContractFieldName | null = pending[0] ?? null;

    const hasLegalResponsibleName = Boolean(String(snapshot.legal_responsible_name ?? "").trim());
    const dynamicOptionalFields: Set<string> = new Set(CONTRACT_OPTIONAL_FIELDS as unknown as Set<string>);
    if (hasLegalResponsibleName) dynamicOptionalFields.delete("legal_responsible_cpf");

    return Response.json({
      ok: true,
      leadId: String(lead.id),
      snapshot,
      allFieldOrder: CONTRACT_FIELD_ORDER as unknown as ContractFieldName[],
      optionalFields: Array.from(dynamicOptionalFields) as unknown as ContractFieldName[],
      fieldLabels: CONTRACT_FIELD_LABELS,
      nextField: next,
      allFields: (CONTRACT_FIELD_ORDER as unknown as readonly ContractFieldName[]).map((name) => ({
        name,
        optional: dynamicOptionalFields.has(name as any),
        label: CONTRACT_FIELD_LABELS[name],
        currentValue: snapshot[name] === "" ? null : snapshot[name],
        alreadyFilled: snapshot[name] !== null,
      })),
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: toErrorMessage(e, "Falha ao carregar dados do contrato.") }, { status: 500 });
  }
}
