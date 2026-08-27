import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function isUndefinedColumnError(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  if (code === "42703") return true;
  const msg = String(error instanceof Error ? error.message : (error as any)?.message ?? "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Corpo inválido." }, { status: 400 });
    }
    const b = body as { telefone?: unknown; lead_id?: unknown };
    const safePhone = String(b.telefone ?? "").replace(/\D/g, "").trim();
    const leadId = String(b.lead_id ?? "").trim();
    if (safePhone.length < 10 && !leadId) {
      return NextResponse.json({ ok: false, error: "telefone ou lead_id obrigatório" }, { status: 400 });
    }
    const admin = createSupabaseAdminClient();
    let existing: any = null;
    if (leadId) {
      const r = await admin.from("atendimento_leads").select("id, phone").eq("id", leadId).limit(1).maybeSingle();
      if (!r.error && r.data) existing = r.data;
    }
    if (!existing && safePhone) {
      const r = await admin.from("atendimento_leads").select("id, phone").eq("phone", safePhone).limit(1).maybeSingle();
      if (!r.error && r.data) existing = r.data;
    }
    if (!existing?.id) {
      return NextResponse.json({ ok: false, error: "lead não encontrada" }, { status: 404 });
    }
    const dismissedAt = new Date().toISOString();
    let ok = false;
    try {
      const r = await admin
        .from("atendimento_leads")
        .update({ recurring_matricula_concluida_dismissed_at: dismissedAt } as any)
        .eq("id", String(existing.id));
      if (!r.error) ok = true;
      else if (isUndefinedColumnError(r.error)) ok = true;
    } catch (e) {
      if (isUndefinedColumnError(e)) ok = true;
    }
    if (!ok) {
      return NextResponse.json({ ok: false, error: "falha ao salvar no banco" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, dismissed_at: dismissedAt });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e ?? "Erro dismiss status.") },
      { status: 500 },
    );
  }
}
