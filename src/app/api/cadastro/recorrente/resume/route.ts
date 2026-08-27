import { NextRequest, NextResponse } from "next/server";
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

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const rawBody = (await req.json().catch(() => null)) as {
      telefone?: string | null;
      senha?: string | null;
    } | null;

    const telefoneRaw = String(rawBody?.telefone ?? "").trim();
    const senhaRaw = String(rawBody?.senha ?? "").trim();

    const safePhoneDigits = telefoneRaw.replace(/\D/g, "").trim();
    if (safePhoneDigits.length < 10) {
      return NextResponse.json(
        { ok: false, error: "Telefone inválido." },
        { status: 400 },
      );
    }
    if (!senhaRaw) {
      return NextResponse.json(
        { ok: false, error: "Senha obrigatória." },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();
    let lead = await findLeadByPhone({ phone: safePhoneDigits });
    if (!lead?.id) {
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          error:
            "Acesso bloqueado. Seu cadastro foi excluído. Para acessar novamente, inicie um novo atendimento pelo WhatsApp.",
        },
        { status: 403 },
      );
    }

    const readStr = (key: string) => {
      const v = (lead as any)?.[key];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };

    const savedPassword = readStr("recurring_registration_password");
    if (!savedPassword) {
      return NextResponse.json(
        { ok: false, error: "Nenhuma senha cadastrada para este telefone." },
        { status: 404 },
      );
    }

    if (savedPassword !== senhaRaw) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Essa senha não confere com a cadastrada em nosso sistema. Entre em contato com o suporte para que possamos ajudá-lo.",
        },
        { status: 401 },
      );
    }

    const stepRaw = (lead as any)?.recurring_registration_step;
    const parsedStep =
      typeof stepRaw === "number" && stepRaw >= 0 && stepRaw <= 6
        ? (stepRaw as 0 | 1 | 2 | 3 | 4 | 5 | 6)
        : 0;
    const safeStep = parsedStep > 0 ? parsedStep : 1;

    return NextResponse.json({
      ok: true,
      resume: true,
      lead: {
        id: (lead as any).id,
        phone: String((lead as any).phone ?? ""),
        full_name: readStr("full_name"),
        contract_pdf_url: readStr("contract_pdf_url"),
        contract_signed_at: readStr("contract_signed_at"),
        state: readStr("state"),
        city: readStr("city"),
        country: readStr("country"),
        timezone: readStr("timezone"),
      },
      progress: {
        step: safeStep,
        has_password: true,
        recurring_class_weekday: readStr("recurring_class_weekday"),
        recurring_class_weekday_label: readStr("recurring_class_weekday_label"),
        recurring_class_professor_time: readStr("recurring_class_professor_time"),
        recurring_class_lead_time: readStr("recurring_class_lead_time"),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: toErrorMessage(e, "Erro ao retomar o cadastro.") },
      { status: 500 },
    );
  }
}
