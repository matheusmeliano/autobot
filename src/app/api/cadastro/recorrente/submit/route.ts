import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findLeadByPhone } from "@/lib/atendimento/server";
import { RECURRING_WEEKDAY_LABELS_PT_BR } from "@/lib/atendimento/experimentalClass";

function toNomeESobrenome(raw: string | null | undefined): string {
  const clean = String(raw ?? "").trim();
  if (!clean) return "";
  const parts = clean.split(/\s+/).filter((s) => s && s.trim());
  if (parts.length <= 2) return clean;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

export const runtime = "nodejs";

type SubmitPayload = {
  nome?: string | null;
  telefone: string;
  senha?: string | null;
  weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
  professorTime: string;
  leadTime?: string | null;
  weekdayLabel?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const rawBody = (await req.json().catch(() => null)) as SubmitPayload | null;
    if (!rawBody || typeof rawBody !== "object") {
      return NextResponse.json({ ok: false, error: "Corpo inválido." }, { status: 400 });
    }
    const {
      nome,
      telefone,
      senha,
      weekday,
      professorTime,
      leadTime,
      weekdayLabel,
    } = rawBody as SubmitPayload;

    const safePhoneDigits = String(telefone ?? "").replace(/\D/g, "").trim();
    if (safePhoneDigits.length < 10) {
      return NextResponse.json({ ok: false, error: "Telefone inválido." }, { status: 400 });
    }
    if (!weekday || !["mon", "tue", "wed", "thu", "fri", "sat"].includes(String(weekday))) {
      return NextResponse.json({ ok: false, error: "Dia inválido." }, { status: 400 });
    }
    if (!String(professorTime ?? "").trim()) {
      return NextResponse.json({ ok: false, error: "Horário inválido." }, { status: 400 });
    }

    const safeNome = toNomeESobrenome(nome);

    const admin = createSupabaseAdminClient();
    const lead = await findLeadByPhone({ phone: safePhoneDigits });
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

    const safeWeekdayLabel =
      String(weekdayLabel ?? "").trim() ||
      RECURRING_WEEKDAY_LABELS_PT_BR[weekday as keyof typeof RECURRING_WEEKDAY_LABELS_PT_BR] ||
      "";
    const nowIso = new Date().toISOString();

    const patchFull: Record<string, unknown> = {
      recurring_class_status: "confirmado",
      recurring_class_weekday: weekday,
      recurring_class_weekday_label: safeWeekdayLabel,
      recurring_class_professor_time: String(professorTime ?? "").trim(),
      recurring_class_lead_time: String(leadTime ?? String(professorTime ?? "")).trim(),
      recurring_class_created_at: nowIso,
      funnel_stage: "contrato_coletando_dados",
      status: "contrato_coletando_dados",
      contract_status: "coletando_dados",
      updated_at: nowIso,
      ...(safeNome ? { full_name: safeNome } : {}),
      ...(String(senha ?? "").trim() ? { signup_password_raw_temp: String(senha ?? "").trim() } : {}),
    };

    const patchMinimalGuaranteed: Record<string, unknown> = {
      recurring_class_status: "confirmado",
      recurring_class_weekday: weekday,
      funnel_stage: "contrato_coletando_dados",
      status: "contrato_coletando_dados",
      contract_status: "coletando_dados",
      updated_at: nowIso,
      ...(safeNome ? { full_name: safeNome } : {}),
    };

    let appliedPatch: "full" | "minimal" = "minimal";
    let fullPatchError: string | null = null;
    try {
      const { error: errFull } = await admin
        .from("atendimento_leads")
        .update(patchFull as any)
        .eq("id", String(lead.id));
      if (errFull) throw errFull;
      appliedPatch = "full";
    } catch (e1) {
      appliedPatch = "minimal";
      fullPatchError = e1 instanceof Error ? e1.message : String(e1 ?? "");
      try {
        const { error: errMin } = await admin
          .from("atendimento_leads")
          .update(patchMinimalGuaranteed as any)
          .eq("id", String(lead.id));
        if (errMin) throw errMin;
      } catch (e2) {
        return NextResponse.json(
          {
            ok: false,
            error: e2 instanceof Error ? e2.message : String(e2 ?? "Erro ao atualizar lead."),
          },
          { status: 500 },
        );
      }
    }

    try {
      const { data: convRow } = await admin
        .from("atendimento_conversations")
        .select("id")
        .eq("lead_id", String(lead.id))
        .eq("channel", "whatsapp")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if ((convRow as any)?.id) {
        const { appendHistoryEvent } = await import("@/lib/atendimento/server");
        await appendHistoryEvent({
          leadId: String(lead.id),
          conversationId: String((convRow as any).id),
          eventType: "recurring_class_scheduled",
          title: "Aula recorrente cadastrada pela plataforma",
          details: {
            weekday,
            weekday_label: safeWeekdayLabel,
            professor_time: String(professorTime ?? ""),
            lead_time: String(leadTime ?? String(professorTime ?? "")),
            applied_patch: appliedPatch,
            full_patch_error: fullPatchError,
            source: "cadastro_recorrente_plataforma",
          },
          actorType: "lead",
        }).catch(() => {});
      }
    } catch {}

    return NextResponse.json({
      ok: true,
      leadId: String(lead.id),
      appliedPatch,
      fullPatchError,
      scheduled: {
        weekday,
        weekdayLabel: safeWeekdayLabel,
        professorTime: String(professorTime ?? "").trim(),
        leadTime: String(leadTime ?? String(professorTime ?? "")).trim(),
      },
      redirect_to: "/atendimento?slug=lucas-brum-online-music-usa",
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err ?? ""),
      },
      { status: 500 },
    );
  }
}
