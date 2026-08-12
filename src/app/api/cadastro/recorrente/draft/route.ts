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

type DraftPayload = {
  telefone: string;
  nome?: string | null;
  weekday?: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | null;
  weekdayLabel?: string | null;
  professorTime?: string | null;
  leadTime?: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    const sp = req.nextUrl.searchParams;
    const telefoneRaw = String(sp.get("telefone") ?? "").trim();
    const safePhoneDigits = telefoneRaw.replace(/\D/g, "").trim();
    if (safePhoneDigits.length < 10) {
      return NextResponse.json({ ok: false, error: "telefone obrigatório" }, { status: 400 });
    }
    const normalizedPhone = safePhoneDigits;
    const { data } = await admin
      .from("atendimento_leads")
      .select("id, phone, full_name")
      .eq("phone", normalizedPhone)
      .limit(1)
      .maybeSingle();
    if (!data) {
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
    return NextResponse.json({
      ok: true,
      lead: {
        id: (data as any).id,
        phone: String((data as any).phone ?? ""),
        full_name: String((data as any).full_name ?? "").trim() || null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e ?? "Erro GET recorrente draft.") },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const rawBody = (await req.json().catch(() => null)) as DraftPayload | null;
    if (!rawBody || typeof rawBody !== "object") {
      return NextResponse.json({ ok: false, error: "Corpo inválido." }, { status: 400 });
    }
    const { telefone, nome, weekday, weekdayLabel, professorTime, leadTime } = rawBody as DraftPayload;

    const safePhoneDigits = String(telefone ?? "").replace(/\D/g, "").trim();
    if (safePhoneDigits.length < 10) {
      return NextResponse.json({ ok: false, error: "Telefone inválido." }, { status: 400 });
    }

    const safeNome = toNomeESobrenome(nome);

    const safeWeekday = weekday ? String(weekday).trim().toLowerCase() : "";
    const validWeekday = safeWeekday && ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(safeWeekday)
      ? (safeWeekday as "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")
      : null;

    const safeProfessorTime = String(professorTime ?? "").trim();
    const safeLeadTime = String(leadTime ?? "").trim();
    const hasAnyTime = Boolean(safeProfessorTime || safeLeadTime);

    if (!validWeekday && !hasAnyTime) {
      return NextResponse.json(
        { ok: false, error: "Informe pelo menos dia ou horário para salvar o rascunho." },
        { status: 400 },
      );
    }

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

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = {
      updated_at: nowIso,
    };

    if (validWeekday) {
      patch.recurring_class_weekday = validWeekday;
      const safeLabel =
        String(weekdayLabel ?? "").trim() ||
        RECURRING_WEEKDAY_LABELS_PT_BR[validWeekday as keyof typeof RECURRING_WEEKDAY_LABELS_PT_BR] ||
        "";
      if (safeLabel) patch.recurring_class_weekday_label = safeLabel;
    }
    if (safeProfessorTime) patch.recurring_class_professor_time = safeProfessorTime;
    if (safeLeadTime) patch.recurring_class_lead_time = safeLeadTime;
    else if (safeProfessorTime && !String((lead as any)?.recurring_class_lead_time ?? "").trim()) {
      patch.recurring_class_lead_time = safeProfessorTime;
    }

    if (safeNome) {
      patch.full_name = safeNome;
    }

    try {
      const { error } = await admin
        .from("atendimento_leads")
        .update(patch as any)
        .eq("id", String(lead.id));
      if (error) throw error;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "Erro desconhecido.");
      if (/column|does not exist|PGRST204|PGRST205|42703/i.test(msg)) {
        try {
          const fallback: Record<string, unknown> = { updated_at: nowIso };
      if (safeNome) {
            fallback.full_name = safeNome;
          }
          await admin
            .from("atendimento_leads")
            .update(fallback as any)
            .eq("id", String(lead.id));
        } catch {}
      } else {
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
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
          eventType: "recurring_class_draft_saved",
          title: "Rascunho de dia/horário recorrente salvo (plataforma)",
          details: {
            weekday: validWeekday || null,
            weekday_label: patch.recurring_class_weekday_label || null,
            professor_time: safeProfessorTime || null,
            lead_time: (patch.recurring_class_lead_time as string) || null,
            source: "cadastro_recorrente_plataforma_draft",
          },
          actorType: "lead",
        }).catch(() => {});
      }
    } catch {}

    return NextResponse.json({
      ok: true,
      leadId: String(lead.id),
      saved: {
        weekday: validWeekday || null,
        weekday_label: (patch.recurring_class_weekday_label as string) || null,
        professor_time: safeProfessorTime || null,
        lead_time: (patch.recurring_class_lead_time as string) || null,
      },
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
