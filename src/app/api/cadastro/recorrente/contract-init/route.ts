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

    let historyByField: Record<string, string> = {};
    try {
      const { data: hData } = await admin
        .from("atendimento_history_events")
        .select("event_type, details, created_at")
        .eq("lead_id", String(lead.id))
        .eq("event_type", "contract_field_updated")
        .order("created_at", { ascending: false })
        .limit(50);
      const seen = new Set<string>();
      for (const ev of (hData ?? []) as any[]) {
        const details = (ev?.details ?? {}) as Record<string, unknown>;
        const field = String(details?.field ?? "").trim();
        if (!field || seen.has(field)) continue;
        const value = details?.value;
        if (value === null || value === undefined) continue;
        const strVal = typeof value === "string" ? value : String(value ?? "");
        if (strVal) {
          historyByField[field] = strVal;
          seen.add(field);
        }
      }
    } catch {}

    function getRawFieldValue(name: ContractFieldName): string | null {
      if (name === "full_name") {
        const dedicated = typeof (lead as any).contract_full_name === "string" ? String((lead as any).contract_full_name).trim() : "";
        if (dedicated) return dedicated;
        const fromHistory = historyByField["full_name"];
        if (fromHistory) return fromHistory;
        const v = lead.full_name;
        if (v === "") return "";
        return String(v ?? "").trim() || null;
      }
      if (name === "phone") {
        const dedicated = typeof (lead as any).contract_phone === "string" ? String((lead as any).contract_phone).replace(/\D/g, "").trim() : "";
        if (dedicated) return dedicated;
        const fromHistory = String(historyByField["phone"] ?? "").replace(/\D/g, "").trim();
        if (fromHistory) return fromHistory;
        const v = lead.phone;
        if (v === "") return "";
        const p = String(v ?? "").replace(/\D/g, "").trim();
        return p || null;
      }
      if (name === "cpf") {
        const v = lead.cpf;
        if (v === "") return "";
        return String(v ?? "").replace(/\D/g, "").trim() || null;
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
