import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findLeadByPhone } from "@/lib/atendimento/server";
import { RECURRING_WEEKDAY_LABELS_PT_BR } from "@/lib/atendimento/experimentalClass";

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
  step?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | null;
  password?: string | null;
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
    let data: any = null;
    try {
      const sel = await admin
        .from("atendimento_leads")
        .select(
          "id, phone, full_name, cpf, recurring_registration_step, recurring_registration_password, recurring_class_weekday, recurring_class_weekday_label, recurring_class_professor_time, recurring_class_lead_time, legal_responsible_name, legal_responsible_cpf",
        )
        .eq("phone", normalizedPhone)
        .limit(1)
        .maybeSingle();
      if (sel?.error) {
        if (/column.*does not exist|PGRST204|42703/i.test(String(sel.error?.message ?? ""))) {
          const fallback = await admin
            .from("atendimento_leads")
            .select("id, phone, full_name, cpf")
            .eq("phone", normalizedPhone)
            .limit(1)
            .maybeSingle();
          data = fallback?.data ?? null;
        } else {
          throw sel.error;
        }
      } else {
        data = sel?.data ?? null;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      if (/column.*does not exist|PGRST204|42703/i.test(msg)) {
        const fallback = await admin
          .from("atendimento_leads")
          .select("id, phone, full_name, cpf")
          .eq("phone", normalizedPhone)
          .limit(1)
          .maybeSingle();
        data = fallback?.data ?? null;
      } else {
        throw e;
      }
    }
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
    const stepRaw = (data as any)?.recurring_registration_step;
    const parsedStep =
      typeof stepRaw === "number" && stepRaw >= 0 && stepRaw <= 9
        ? (stepRaw as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9)
        : 0;
    return NextResponse.json({
      ok: true,
      lead: {
        id: (data as any).id,
        phone: String((data as any).phone ?? ""),
        full_name: String((data as any).full_name ?? "").trim() || null,
        cpf: String((data as any).cpf ?? "").trim() || null,
        legal_responsible_name: String((data as any).legal_responsible_name ?? "").trim() || null,
        legal_responsible_cpf: String((data as any).legal_responsible_cpf ?? "").trim() || null,
      },
      progress: {
        step: parsedStep,
        has_password: Boolean(String((data as any).recurring_registration_password ?? "").trim()),
        recurring_class_weekday: String((data as any).recurring_class_weekday ?? "").trim() || null,
        recurring_class_weekday_label:
          String((data as any).recurring_class_weekday_label ?? "").trim() || null,
        recurring_class_professor_time:
          String((data as any).recurring_class_professor_time ?? "").trim() || null,
        recurring_class_lead_time:
          String((data as any).recurring_class_lead_time ?? "").trim() || null,
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
    const { telefone, nome, weekday, weekdayLabel, professorTime, leadTime, step, password } =
      rawBody as DraftPayload;

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

    const safeStepRaw =
      typeof step === "number" && Number.isInteger(step) && step >= 0 && step <= 9 ? step : null;

    const safePassword =
      typeof password === "string" && password.trim().length >= 4 ? password.trim() : null;

    const hasAnyPayload =
      Boolean(validWeekday) ||
      hasAnyTime ||
      Boolean(safeNome) ||
      safeStepRaw !== null ||
      Boolean(safePassword);

    if (!hasAnyPayload) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Informe pelo menos dia, horário, nome, etapa do passo (step) ou senha para salvar o progresso.",
        },
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

    const currentStatus = String((lead as any)?.status ?? "").trim().toLowerCase();
    const currentFunnel = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
    const currentRcs = String((lead as any)?.recurring_class_status ?? "").trim().toLowerCase();

    function shouldPromoteToAlunosSection(): boolean {
      const stChain = new Set([
        "matriculado",
        "aluno",
        "cadastro_recorrente_pendente_plataforma",
        "contrato_assinado",
        "contrato_aguardando_aceite",
        "contrato_coletando_dados",
        "matricula_confirmada",
      ]);
      if (stChain.has(currentStatus) || stChain.has(currentFunnel)) return false;
      if (currentRcs === "confirmado" || currentRcs === "cadastro_plataforma_pendente") return false;

      // Se for interessado:
      //   - salvou senha OU salvou dia/horário OU avançou step (>=1) → promover
      if (safePassword) return true;
      if (validWeekday || safeProfessorTime || safeLeadTime) return true;
      if (safeStepRaw !== null && safeStepRaw >= 1) return true;
      return false;
    }

    if (shouldPromoteToAlunosSection()) {
      patch.status = patch.status ?? "aluno";
      patch.funnel_stage = patch.funnel_stage ?? "cadastro_recorrente_pendente_plataforma";
      if (!currentRcs) {
        patch.recurring_class_status = "cadastro_plataforma_pendente";
      }
    }

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

    if (safeStepRaw !== null) {
      patch.recurring_registration_step = safeStepRaw;
    }

    if (safePassword) {
      patch.recurring_registration_password = safePassword;
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
        step: safeStepRaw ?? null,
        has_password: Boolean(safePassword),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: toErrorMessage(err, ""),
      },
      { status: 500 },
    );
  }
}
