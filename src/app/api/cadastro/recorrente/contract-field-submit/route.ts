import { CONTRACT_FIELD_ORDER, CONTRACT_OPTIONAL_FIELDS, CONTRACT_FIELD_LABELS } from "@/lib/atendimento/constants";
import type { CONTRACT_FIELD_ORDER as CFO } from "@/lib/atendimento/constants";
import {
  validateContractFieldValue,
  normalizeContractFieldSkip,
} from "@/lib/atendimento/bot";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendHistoryEvent, findLeadByPhone } from "@/lib/atendimento/server";

type ContractFieldName = (typeof CFO)[number];

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const telefone = String(body?.telefone ?? "").replace(/\D/g, "").trim();
  const leadId = String(body?.leadId ?? "").trim();
  const fieldName = String(body?.field ?? "").trim() as ContractFieldName;
  const rawValue = String(body?.value ?? "").trim();
  const skip = Boolean(body?.skip ?? false);
  try {
    if (!(CONTRACT_FIELD_ORDER as readonly string[]).includes(fieldName)) {
      return Response.json({ ok: false, error: "Campo inválido." }, { status: 400 });
    }
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

    const optional = CONTRACT_OPTIONAL_FIELDS.has(fieldName as any);
    let valueToSave: string | null = null;
    let skipped = false;

    if (skip || normalizeContractFieldSkip(rawValue)) {
      if (!optional) {
        return Response.json({
          ok: false,
          error: `Campo "${CONTRACT_FIELD_LABELS[fieldName as ContractFieldName] ?? fieldName}" é obrigatório e não pode ser pulado.`,
          code: "field_required",
        }, { status: 400 });
      }
      skipped = true;
      valueToSave = "";
    } else {
      const validation: { ok: true; value: string | null; skipped?: boolean } | { ok: false; reason?: string } =
        validateContractFieldValue(fieldName as any, rawValue) as any;
      if (!validation.ok) {
        return Response.json({
          ok: false,
          error: (validation as any).reason || "Valor inválido para este campo.",
          code: "validation_error",
        }, { status: 400 });
      }
      if ((validation as any).skipped) {
        if (!optional) {
          return Response.json({
            ok: false,
            error: `Campo "${CONTRACT_FIELD_LABELS[fieldName as ContractFieldName] ?? fieldName}" é obrigatório.`,
            code: "field_required",
          }, { status: 400 });
        }
        skipped = true;
        valueToSave = "";
      } else {
        valueToSave = (validation as any).value ?? null;
      }
    }

    let patch: any = {};
    if (fieldName === "full_name") {
      patch = { full_name: valueToSave, nome_completo: valueToSave, nome: valueToSave };
    } else if (fieldName === "cpf") {
      patch = { cpf: valueToSave };
    } else if (fieldName === "phone") {
      patch = { phone_digits: valueToSave, telefone: valueToSave };
    } else if (fieldName === "legal_responsible_name") {
      patch = { legal_responsible_name: valueToSave };
    } else if (fieldName === "legal_responsible_cpf") {
      patch = { legal_responsible_cpf: valueToSave };
    }

    let updatedLead: any = null;
    try {
      const { data, error } = await admin
        .from("atendimento_leads")
        .update(patch)
        .eq("id", String(lead.id))
        .select("*")
        .maybeSingle();
      if (error) {
        console.error("update lead contract field supabase error:", error?.message || error);
        return Response.json({ ok: false, error: "Falha ao salvar no banco. Tente novamente." }, { status: 500 });
      }
      if (!data) {
        return Response.json({ ok: false, error: "Cadastro não encontrado após salvar." }, { status: 404 });
      }
      updatedLead = data;
    } catch (e: any) {
      console.error("update lead contract field exception error:", e?.message || e);
      return Response.json({ ok: false, error: String(e?.message || "Falha ao salvar o campo (exceção).") }, { status: 500 });
    }

    try {
      await appendHistoryEvent({
        leadId: String(lead.id),
        eventType: "contract_field_updated",
        title: skipped
          ? `[Contrato] Campo ${CONTRACT_FIELD_LABELS[fieldName as ContractFieldName] ?? fieldName}: pulado (opcional)`
          : `[Contrato] Campo ${CONTRACT_FIELD_LABELS[fieldName as ContractFieldName] ?? fieldName}: atualizado`,
        details: { field: fieldName, value: valueToSave, skipped },
        actorType: "system",
      } as any);
    } catch {}

    function getRawFieldValue(name: ContractFieldName, updated: any, old: any): string | null {
      const src = updated && typeof updated === "object" ? updated : old;
      const obj = { ...(old ?? {}), ...(src ?? {}) };
      if (name === "full_name") {
        const v =
          (src ?? {}).full_name ??
          (src ?? {}).nome_completo ??
          (src ?? {}).nome ??
          obj.full_name ??
          obj.nome_completo ??
          obj.nome;
        if (v === "") return "";
        return String(v ?? "").trim() || null;
      }
      if (name === "cpf") {
        const v = (src ?? {}).cpf ?? obj.cpf;
        if (v === "") return "";
        return String(v ?? "").replace(/\D/g, "").trim() || null;
      }
      if (name === "phone") {
        const v =
          (src ?? {}).phone_digits ??
          (src ?? {}).telefone ??
          (src ?? {}).whatsapp ??
          (src ?? {}).phone ??
          obj.phone_digits ??
          obj.telefone ??
          obj.whatsapp ??
          obj.phone;
        if (v === "") return "";
        const p = String(v ?? "").replace(/\D/g, "").trim();
        return p || null;
      }
      if (name === "legal_responsible_name") {
        const v = (src ?? {}).legal_responsible_name ?? obj.legal_responsible_name;
        if (v === "") return "";
        return String(v ?? "").trim() || null;
      }
      if (name === "legal_responsible_cpf") {
        const v = (src ?? {}).legal_responsible_cpf ?? obj.legal_responsible_cpf;
        if (v === "") return "";
        return String(v ?? "").replace(/\D/g, "").trim() || null;
      }
      return null;
    }

    const snapshot: Record<ContractFieldName, string | null> = {
      full_name: getRawFieldValue("full_name", updatedLead, lead),
      cpf: getRawFieldValue("cpf", updatedLead, lead),
      phone: getRawFieldValue("phone", updatedLead, lead),
      legal_responsible_name: getRawFieldValue("legal_responsible_name", updatedLead, lead),
      legal_responsible_cpf: getRawFieldValue("legal_responsible_cpf", updatedLead, lead),
    };

    const pending: ContractFieldName[] = (CONTRACT_FIELD_ORDER as unknown as readonly ContractFieldName[]).filter(
      (name) => snapshot[name] === null,
    );
    const nextField: ContractFieldName | null = pending[0] ?? null;

    return Response.json({
      ok: true,
      savedField: fieldName,
      savedValue: valueToSave,
      skipped,
      snapshot,
      nextField,
      allFields: (CONTRACT_FIELD_ORDER as unknown as readonly ContractFieldName[]).map((name) => ({
        name,
        optional: CONTRACT_OPTIONAL_FIELDS.has(name as any),
        label: CONTRACT_FIELD_LABELS[name],
        currentValue: snapshot[name],
        alreadyFilled: Boolean(snapshot[name]),
      })),
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message ?? "Falha ao salvar o campo.") }, { status: 500 });
  }
}
