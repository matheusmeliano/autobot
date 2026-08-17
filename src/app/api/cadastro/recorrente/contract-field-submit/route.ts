import { CONTRACT_FIELD_ORDER, CONTRACT_OPTIONAL_FIELDS, CONTRACT_FIELD_LABELS } from "@/lib/atendimento/constants";
import type { CONTRACT_FIELD_ORDER as CFO } from "@/lib/atendimento/constants";
import {
  validateContractFieldValue,
  normalizeContractFieldSkip,
} from "@/lib/atendimento/bot";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendHistoryEvent, findLeadByPhone } from "@/lib/atendimento/server";

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
    if (!lead?.id && telefone.length >= 10) {
      try {
        function phoneCandidates(base: string): string[] {
          const out = new Set<string>();
          out.add(base);
          if (base.startsWith("55") && base.length >= 12) out.add(base.slice(2));
          else if (base.length >= 10 && !base.startsWith("55")) out.add(`55${base}`);
          if (base.length === 10 && !base.startsWith("55")) {
            const ddd = base.slice(0, 2); const rest = base.slice(2);
            out.add(`${ddd}9${rest}`); out.add(`55${ddd}9${rest}`);
          } else if (base.length === 11 && !base.startsWith("55") && base[2] === "9") {
            const ddd = base.slice(0, 2); const rest = base.slice(3);
            out.add(`${ddd}${rest}`); out.add(`55${ddd}${rest}`);
          } else if (base.length === 13 && base.startsWith("55") && base[4] === "9") {
            const ddd = base.slice(2, 4); const rest = base.slice(5);
            out.add(`55${ddd}${rest}`); out.add(`${ddd}${rest}`);
          } else if (base.length === 12 && base.startsWith("55")) {
            const ddd = base.slice(2, 4); const rest = base.slice(4);
            out.add(`55${ddd}9${rest}`); out.add(`${ddd}9${rest}`);
          }
          return Array.from(out);
        }
        const cands = phoneCandidates(telefone);
        const { data: fbData } = await admin
          .from("atendimento_leads")
          .select("*")
          .in("phone", cands)
          .order("created_at", { ascending: false })
          .limit(5)
          .maybeSingle();
        if (fbData && (fbData as any).id) lead = fbData as any;
      } catch {}
    }
    if (!lead?.id) {
      return Response.json({
        ok: false,
        blocked: true,
        error:
          "Acesso bloqueado. Seu cadastro foi excluído. Para acessar novamente, inicie um novo atendimento pelo WhatsApp.",
      }, { status: 403 });
    }

    const hasLegalResponsibleNameBefore = Boolean(String(lead.legal_responsible_name ?? "").trim());
    const dynamicOptionalFields: Set<string> = new Set(CONTRACT_OPTIONAL_FIELDS as unknown as Set<string>);
    if (hasLegalResponsibleNameBefore) dynamicOptionalFields.delete("legal_responsible_cpf");
    if (fieldName === "legal_responsible_name" && !skip && !normalizeContractFieldSkip(rawValue)) {
      dynamicOptionalFields.delete("legal_responsible_cpf");
    }
    const optional = dynamicOptionalFields.has(fieldName as any);
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
      patch = { full_name: valueToSave };
    } else if (fieldName === "cpf") {
      patch = { cpf: valueToSave };
    } else if (fieldName === "phone") {
      patch = { phone: valueToSave };
    } else if (fieldName === "legal_responsible_name") {
      if (skipped) {
        patch = { legal_responsible_name: null, legal_responsible_cpf: null };
      } else {
        patch = { legal_responsible_name: valueToSave };
      }
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
      console.error("update lead contract field exception error:", toErrorMessage(e, ""));
      return Response.json({ ok: false, error: toErrorMessage(e, "Falha ao salvar o campo (exceção).") }, { status: 500 });
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
        const v = (src ?? {}).full_name ?? obj.full_name;
        if (v === "") return "";
        return String(v ?? "").trim() || null;
      }
      if (name === "cpf") {
        const v = (src ?? {}).cpf ?? obj.cpf;
        if (v === "") return "";
        return String(v ?? "").replace(/\D/g, "").trim() || null;
      }
      if (name === "phone") {
        const v = (src ?? {}).phone ?? obj.phone;
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

    const hasLegalResponsibleNameAfter = Boolean(String(snapshot.legal_responsible_name ?? "").trim());
    const finalOptionalFields: Set<string> = new Set(CONTRACT_OPTIONAL_FIELDS as unknown as Set<string>);
    if (hasLegalResponsibleNameAfter) finalOptionalFields.delete("legal_responsible_cpf");

    return Response.json({
      ok: true,
      savedField: fieldName,
      savedValue: valueToSave,
      skipped,
      snapshot,
      nextField,
      allFields: (CONTRACT_FIELD_ORDER as unknown as readonly ContractFieldName[]).map((name) => ({
        name,
        optional: finalOptionalFields.has(name as any),
        label: CONTRACT_FIELD_LABELS[name],
        currentValue: snapshot[name],
        alreadyFilled: Boolean(snapshot[name]),
      })),
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: toErrorMessage(e, "Falha ao salvar o campo.") }, { status: 500 });
  }
}
